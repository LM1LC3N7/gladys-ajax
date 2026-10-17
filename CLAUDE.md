# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency. Gladys becomes the SIA DC-09 monitoring station of Ajax
Systems hubs: a `sia-receiver` sub-container (same image, `node
src/receiver.js`) publishes the SIA port, acknowledges the hubs and hands the
messages to the main container over the private network of the integration.
SIA is one-way: nothing is commanded. Unofficial, not affiliated with Ajax
Systems.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/receiver.test.js         # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
e2e/run.sh                                # Docker: image, receiver, SIA client
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js              main container: SDK bootstrap only
src/handlers.js       every SDK handler -> the app (shared with the tests)
src/app.js            AjaxApp: receiver start (env), channel, states, scene
                      events, supervision, buttons, /data persistence
src/model.js          SIA events -> account state and effects (pure)
src/devices.js        -> Gladys device and states (pure)
src/config.js         config_schema normalized, the receiver env
src/store.js          /data/ajax-state.json
src/channel.js        receiver <-> main: JSON lines, HMAC handshake + MACs, queue
src/constants.js      manifest keys, receiver, value lists, timings
src/i18n.js           names and texts (fr/en), SIA code labels
src/receiver.js       sub-container entry point
src/sia/service.js    receiver service: env -> listeners + channel
src/sia/server.js     TCP / UDP listeners
src/sia/receiver.js   one message -> ACK / NAK / DUH + events (pure)
src/sia/frame.js      framing, CRC-16/ARC, AES-CBC, timestamps, keys
src/sia/content.js    data block -> events (SIA-DCS, ADM-CID, NULL)
src/sia/codes.js      SIA code table + ADM-CID mapping (generated, pysiaalarm)
test/fixtures/        SIA lines from pysiaalarm's tests
test/helpers/         an independent SIA transmitter (tests and e2e)
e2e/                  Docker check of the real image
```

## Rules

- **External ids are forever**: device `hub:<account>`; features `mode`,
  `alarm`, `tamper`, `battery-low`, `mains-power`, `device-link`, `online`,
  `armed-groups`, `last-event`. Never change how they are built.
- Manifest keys (config keys, actions, scene triggers and their fields and
  variables), the sub-container name `sia-receiver`, its port names `sia` and
  `sia_udp`, the mode values (`disarmed`, `armed`, `night`, `partial`) and
  the kinds are frozen: users store them in scenes.
- **Never answer a panel wrongly**: an ACK means "received"; anything the
  receiver cannot check (CRC, account, key, clock) gets a NAK so the panel
  resends, what it cannot read a DUH. Never ACK an unencrypted message on an
  account with a key.
- **Secrets**: the key travels only in the receiver env (`startContainer`)
  and is stored as a `secret` config field; never log it, never put it in the
  manifest, never send it on the channel.
- The receiver has no Gladys credentials; the channel port (7778) is never
  published; only the main container (which knows the token) reads it.
  Channel protocol 2: mutual HMAC challenge-response (the token never on the
  wire), then `{ seq, data, mac }` on every receiver line; a change of the
  protocol bumps `CHANNEL_PROTOCOL` in `receiverEnv` so old receivers are
  recreated. Never call the channel encrypted: it is authenticated only.
- Value conventions: the Gladys side uses the enums of the core
  `server/utils/constants.js` (binary 1 = on; `mains-power`, `device-link`
  and `online` are 1 when OK), the SDK does not export them.
- Events go through `publishStates` (repeated values matter), scene events
  are capped at 240 per minute (Gladys: 300 states and 300 scene events per
  minute).
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable (the main container keeps its state there; the receiver writes
  nothing), bridge network.
- Tests never touch the network beyond 127.0.0.1.
- Code, comments, README in English; `docs/fr.md` and `docs/en.md` kept in
  sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
