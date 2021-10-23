require('dotenv').config();

const WebSocket = require("ws");
const child = require("child_process");
const discord = require('./discord');
const { CHSERVER_BIN_PATH, BASTION_WS_PORT } = process.env;

let cache = [];
try {
  cache = require('./cache.json');
  console.log('Cache found, recovering state...');
} catch {
  console.log('Nothing cached, starting from scratch...');
}

const servers = [];
for (let i = 1; process.env[`BASTION_SERVER_${i}_NAME`]; ++i) {
  servers.push({
    name: process.env[`BASTION_SERVER_${i}_NAME`],
    password: process.env[`BASTION_SERVER_${i}_PASSWORD`],
    port: process.env[`BASTION_SERVER_${i}_PORT`],
    loghook: process.env[`BASTION_SERVER_${i}_LOGHOOK`],
    statushook: process.env[`BASTION_SERVER_${i}_STATUSHOOK`],
    scene: 'lobby',
    players: [],
    // TODO: Explore the ability to broadcast multiple games,
    // perhaps through multiple WebSocket servers?
    broadcast: i === 1
  });
  if (cache[i-1]) {
    servers[i-1].messageId = cache[i-1].messageId;
  }
}
if (!servers.length) throw new Error('Please `cp .env.example .env` and follow the example to configure servers.');

let wss;
const broadcast = msg => wss.clients.forEach(s => {
  if (s.readyState === WebSocket.OPEN) s.send(msg);
});

const makeOnGameData = server => data => {
  data.toString("utf8").split('\n').forEach(msg => onGameData(msg, server));
};

// TODO: It'd probably be wise to split and refactor
// each of those handlers in their own files
const onGameData = (msg, server) => {
  if (msg.startsWith("game")) {
    // To try and attempt to save bandwidth/performance, we try and see
    // if the data has actually changed before we decide
    // whether to broadcast or not.
    const [, playerIndex, newScore, newCombo, newSp] = msg.split(' ');
    let changed = false;
    // Failsafe: If for some reason, the player profile was not detected,
    // slip in a '???' player.
    if (!server.players[playerIndex] && +playerIndex <= 1) {
      server.players[playerIndex] = { name: '???' };
    }
    const player = server.players[playerIndex];
    if (player) {
      const { score, combo, sp } = player;
      changed = newScore != score || newCombo != combo || newSp != sp;
      server.players[playerIndex].score = newScore;
      server.players[playerIndex].combo = newCombo;
      server.players[playerIndex].sp = newSp;
      if (server.broadcast && changed) broadcast(msg);
    }
  } else if (msg.startsWith("profile")) {
    // For profiles, we only really want to know who joined in which spot,
    // not the entire profile information.
    const [, playerIndex, ...rest] = msg.split(' ');
    let name = '';
    // Profile string starts at the 3rd byte,
    // and anything below 32 (space) should mark the end of the profile name string.
    for (let i = 1; +rest[i] >= 32; ++i) {
      name += String.fromCharCode(rest[i]);
    }
    // Trim tags away just in case
    name = name.trim().replace(/<[^>]*(b|i|color|size|material|quad)[^>]*>/g, "");
    // If the player hasn't changed, don't send the information again
    if (!server.players[playerIndex] || server.players[playerIndex].name != name) {
      server.players[playerIndex] = { name };
      if (server.broadcast) broadcast(`profile ${playerIndex} ${name}`);
      // Players can only join in the lobby, and that hook refreshes the players
      discord.onLobby(server);
    }
  } else if (msg.startsWith('disconnect')) {
    server.players[msg.split(' ')[1]] = null;
    switch (server.scene) {
      case 'lobby': discord.onLobby(server); break;
      case 'songList': discord.onSongList(server); break;
      case 'instrument': discord.onSongSelect(server); break;
      case 'gameplay': discord.onGameplay(server); break;
      case 'stats': discord.onResults(server); break;
    }
  } else if (msg.startsWith('chat')) {
    // Just forward chat messages for now, but some of them from playerIndex 255
    // might contain hookable information.
    if (server.broadcast) broadcast(msg);
  } else if (msg.startsWith('scene')) {
    if (server.broadcast) broadcast(msg);
    const [, scene] = msg.split(' ');
    server.scene = scene;
    switch (scene) {
      case 'lobby': discord.onLobby(server); break;
      case 'songList': discord.onSongList(server); break;
      case 'instrument': discord.onSongSelect(server); break;
      case 'gameplay': discord.onGameplay(server); break;
      case 'stats': discord.onResults(server); break;
    }
  } else if (msg.startsWith('addSong')) {
    if (server.broadcast) broadcast(msg);
    // TODO: Find a way to synchronize chart hash and metadata
    // Maybe there's a way we can do a back-and-forth: broadcast the hash
    // and wait for a peer to send us the metadata back.
    const [, hash, speed] = msg.split(' ');
    server.song = { hash, speed };
  } else if (msg.startsWith('songLength')) {
    if (server.broadcast) broadcast(msg);
    server.song.length = +msg.split(' ')[1].replace(',', '.');
  } else if (msg.startsWith('stats')) {
    if (server.broadcast) broadcast(msg);
    const [, playerIndex, score, streak, notes, sp, spAccrued] = msg.split(' ');
    const player = server.players[playerIndex];
    player.score = score;
    player.streak = streak;
    player.notes = notes;
    player.sp = sp * 10; // Gameplay is *1000, results is *100
    player.spAccrued = spAccrued;
    // If the stats are already shown and this is coming for some reason,
    // refresh Discord with the extra information
    if (server.scene == 'stats') discord.onResults(server);
  } else if (msg.includes("Server running")) {
    // Detect that the server is actually online through the default logging
    if (server.broadcast) broadcast('online');
    discord.onLobby(server);
  }
};

const main = async () => {
  for (const server of servers) {
    if (server.messageId) {
      await discord.onReboot(server);
    } else {
      await discord.onBoot(server);
    }
  }
  wss = new WebSocket.Server({ port: BASTION_WS_PORT });
  const spawns = servers.map(server => child.spawn(CHSERVER_BIN_PATH, [
    '-p', server.port,
    '-a', '0.0.0.0',
    '-n', server.name,
    ...(server.password ? ['-ps', server.password] : ['-np'])
  ]));
  spawns.forEach((spawn, i) => spawn.stdout.on("data", makeOnGameData(servers[i])));

  let cache;
  wss.on("connection", socket => {
    if (cache) socket.send(cache);
    socket.on("message", async msg => {
      if (msg[0] == '{') {
        cache = msg;
        wss.clients.forEach(s => {
          if (s !== socket && s.readyState === WebSocket.OPEN) {
            s.send(msg);
          }
        });
      } else if (msg.startsWith('please restart ')) {
        const password = msg.replace('please restart ', '').trim();
        const index = servers.find(server => server.password == password);
        if (!servers[index]) return;

        discord.onReboot(servers[index]);
        spawns[index].kill();
        await new Promise(r => setTimeout(r, 2000));
        spawns[index] = child.spawn(CHSERVER_BIN_PATH, [
          '-p', server.port,
          '-a', '0.0.0.0',
          '-n', server.name,
          ...(server.password ? ['-ps', server.password] : ['-np'])
        ]);
        spawns[index].stdout.on('data', makeOnGameData(servers[index]));
        servers[index].scene = 'lobby';
        servers[index].players = [];
      }
    });
  });
}

// Make sure that no other CH online server is running on the machine
child.exec(`ps x | grep chserver | awk '{print $1}' | xargs kill`, main);
// The above is Linux-only, so if you're testing on another OS, just use the following:
// main();

// On graceful exits, save server state for next boot
process.on('exit', () => {
  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(path.resolve(__dirname, 'cache.json'), JSON.stringify(servers, null, 2));
});
