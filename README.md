# Bastion

Bastion serves as a middle man between brutally modded CH servers with online events forwarded to `stdout`
and other systems: it forwards key online events through a WebSocket server. 
It will spawn as many servers as specified in `.env` and monitor their `stdout`s (see `.env.example`).

This is a workaround while we wait for an official, actual and sane(r) Clone Hero WebSocket API.

## Modded server builds

The "modded" server builds with `stdout` patches are currently private,
but can be acquired upon request by asking `Paturages#9405` on Discord (provided you have a good use for them).

Below are the events that are forwarded:

Sample                                          | Description
------------------------------------------------|-------------------------
`addSong D0562B73A03AB2FE2AA70A2D360BD242 120`  | Song selected in songlist. arg1 = chart hash, arg2 = song speed.
`chat 1 yo you suck mate`                       | Chat messages. arg1 = player index, rest = message.
`game 1 133769 420 69.727`                      | Gameplay event. arg1 = player index, arg2 = score, arg3 = combo, arg4 = SP.
`songLength 420.420`                            | Song length in seconds.
`profile 1 69 420 ...`                          | Profile information. arg1 = player index, rest = information as ASCII bytes[]: it should contain the profile name notably.
`scene lobby`                                   | Signals scene changes.
`stats 1 133769 420 727 12 69.6`                | Result stats. Args = player index, score, max streak, notes hit, SP hit, SP accrued * 100.
