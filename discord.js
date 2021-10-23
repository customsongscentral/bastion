const got = require("got");

// We maintain 2 kinds of webhooks:
// - A "loghook": This just creates a new message for everything, which will most likely flood a channel.
// - A "statushook": This creates only one message and subsequent updates will use the same message.
//   Useful for a "server status" channel.
// Both of them are optional: use both, one of them or none.

const logErrResponse = (server, err) => console.error('Hook error:', server.name, err.response.body, payload);

const generate = async (server, payload) => {
  if (!server.loghook && !server.statushook) {
    payload.embeds.forEach(({ title, description }) =>
      console.log(`${server.name} -> ${title}: ${description || '-'}`)
    );
  }
  const args = { responseType: 'json', json: { content: null, ...payload, } };
  if (server.loghook) got.post(server.loghook, args).catch(err => logErrResponse(server, err));
  if (server.statushook) {
    const { body } = await got.post(`${server.statushook}?wait=true`, args);
    return body.id;
  }
};

const update = (server, payload) => {
  if (!server.loghook && !server.statushook) {
    payload.embeds.forEach(({ title, description }) =>
      console.log(`${server.name} -> ${title}: ${description || '-'}`)
    );
  }
  const args = { json: { content: null, ...payload, } };
  got.post(server.loghook, args).catch(err => logErrResponse(server, err));
  got.patch(`${server.statushook}/messages/${server.messageId}`, args).catch(err => logErrResponse(server, err));
};

const getBaseEmbed = server => ({
  fields: server.players.map((player, i) => ({
    name: `Player ${i+1}`,
    value: player ? "`" + player.name + "`" : '-',
    inline: true,
  })),
  author: { name: `${server.name} on port ${server.port}` },
  footer: {
    text: server.password
      ? `\nPassword: \`${server.password}\``
      : "No password required!",
  }
});

module.exports.onBoot = async server => {
  server.messageId = await generate(server, {
    embeds: [{
      title: "Server is booting...",
      description: `Please wait a bit... If this takes too long, this is probably fucked.`,
    }]
  });
};

module.exports.onReboot = server => update(server, {
  embeds: [{
    title: "Server is rebooting...",
    description: `Please wait a bit... If this takes too long, this is probably fucked.`,
  }]
});

module.exports.onLobby = server => update(server, {
  embeds: [{
    ...getBaseEmbed(server),
    title: "Lobby ready to join!",
    color: 0x0ac520
  }]
});

module.exports.onSongList = server => update(server, {
  embeds: [{
    ...getBaseEmbed(server),
    title: "Choosing a song...",
    color: 0x8f98ff
  }]
});

module.exports.onSongSelect = server => update(server, {
  embeds: [{
    ...getBaseEmbed(server),
    // TODO: Find a way to reconcile chart hash with meta
    title: `${server.song.hash} (${server.song.speed}%) picked`,
    color: 0x8f98ff
  }]
});

module.exports.onGameplay = server => update(server, {
  embeds: [{
    ...getBaseEmbed(server),
    // TODO: Find a way to reconcile chart hash with meta
    title: `Playing ${server.song.hash} (${server.song.speed}%)`,
    color: 0xecde74
  }]
});

// TODO: Find a way to reconcile chart hash with meta:
// this would enable computing %s, adding optimal, missed notes and so on...
module.exports.onResults = server => {
  const player1 = server.players[0] || { name: '<disconnected!>', score: '-', notes: '-', streak: '-', sp: '-' };
  const player2 = server.players[1] || { name: '<disconnected!>', score: '-', notes: '-', streak: '-', sp: '-' };
  return update(server, {
    embeds: [{
      ...getBaseEmbed(server),
      title: `${server.song.hash} (${server.song.speed}%)`,
      description: `\`${player1.name}\`: **${player1.score}** (${player1.notes} notes, ${player1.streak} streak, ${player1.sp / 10} SPs)
\`${player2.name}\`: **${player2.score}** (${player2.notes} notes, ${player2.streak} streak, ${player2.sp} SPs)`,
      color: 0x2e60ff
    }]
  });
};
