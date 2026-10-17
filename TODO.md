# TODO — Ajax Systems (SIA DC-09) v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, `e2e/run.sh`, then update README, `docs/fr.md`,
  `docs/en.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the module was claimed in /t/10385 (post #224); the main session posts one
  recap there, with a link to the repo, once published.

## Status

- [x] **Milestone 1 — receiver and devices** (2026-10-16): `sia-receiver`
      sub-container (same image, `node src/receiver.js`, TCP and UDP 7777
      published on host ports chosen by Gladys, `{{gladys_host}}` /
      `{{port:sia}}` / `{{port:sia_udp}}` in the setup section); SIA DC-09
      receiver (CRC-16/ARC, SIA-DCS / ADM-CID / NULL, AES-128/192/256 with
      text or hex keys, ACK / NAK / DUH, clock skew, repeats); JSON-lines
      channel with token and a 500-message queue to the main container;
      one device per account (mode select, alarm, tamper, battery, mains,
      device link, online, armed groups, last event, fr/en); model of the
      Ajax codes (arming, groups, night, duress, alarms, faults, restores);
      supervision from the periodic tests; state kept in `/data`; scene
      triggers `alarm`, `mode_changed`, `fault`, `restore`, `sia_event`;
      buttons `status` and `clear`; docs fr/en. Tested with pysiaalarm's
      frames and an independent SIA transmitter: 104 tests (loopback TCP /
      UDP / channel, the SDK's fake Gladys), and `e2e/run.sh` (also a CI
      job) against the real image: the receiver read-only under 96 MB /
      0.2 CPU (RSS 18 MB) answers 14 + 10 checks (plain and encrypted, TCP
      and UDP, ACK / NAK / DUH, wrong key, unknown account, bad CRC, old
      timestamp, ADM-CID, repeat), the main app in the image (read-only,
      256 MB / 0.5 CPU, RSS 74 MB with the fake Gladys) gets the kept and the
      live messages through the real channel; `node index.js` stays up and
      retries without Gladys (18 MB). The e2e found one bug, fixed: messages
      flushed in one burst were published out of order (now serialized by
      `AjaxApp.exclusive`). Store validator: only "image not pullable" (main
      and sub-container image), 0 warnings. Never run with a real hub.
- [ ] **Milestone 2 — real hub**: run with a real Ajax hub (Hub 2 or Hub 2
      Plus at least, Ethernet and Wi-Fi) and fix what differs (see "To
      check on a real hub"); turn real frames (anonymized: account and key
      changed) into fixtures.
- [ ] **Milestone 3 — more**: optional per-device sub-devices (a device per
      Ajax device number, with names the user types, like
      homebridge-ajax-sia's `devices` list: motion / opening / leak / smoke
      sensors, battery, tamper); per-hub keys; the number of groups so that
      "all groups armed" reads as armed; RSP / key change (`K` xdata) if a
      panel needs it.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## To check on a real hub

- TCP or UDP: which one the hub uses (Ajax documents neither); does it keep
  one TCP connection open ("Connect on demand" off) and reconnect after the
  receiver restarts?
- The encrypted ACK: pysiaalarm and homebridge-ajax-sia send `]_timestamp`
  padded with `0` and no `|`, ioBroker.sia pads with NUL and adds `|`; the
  first form is used here (proven with Ajax by HA users). Check that the hub
  accepts it on every firmware (OS Malevich 2.7 to 2.2x).
- The timestamps: UTC as DC-09 wants (homebridge-ajax-sia's 60 s default
  works with a Hub 2), the NAK with our time making the hub correct its
  clock, and the link tests: `NULL` messages or `RP` events, with or without
  a timestamp, encrypted or not.
- What `ri` the hub sends without groups (0 or 1), and in group mode: `CL`
  for the whole system and `CG` / `OG` per group, `CF` / `AF` for one group
  armed with faults (handled as a group once a group event was seen).
- The number after arming codes (user) and alarm codes (device number) for
  arming from the app, a keyfob, a keypad, a schedule; the `HA` duress
  disarm and `ND`.
- Restores: `BR` after a door closes, `PH` after a panic cancel, `FH` / `GH` /
  `WH` after fire / CO / leak; whether intrusion alarms get a restore at all.
- Faults: `AT` / `AR` with zone 0 for the hub, `YM` / `YA`, `XL` / `XC`,
  `XQ` / `XH`, `YC` / `YK`, `YS` (sent after a reconnection?).
- Several hubs on the same receiver, each with its object number.
- The address shown with `{{gladys_host}}` behind Gladys Plus (the docs say
  to use the LAN IP).

## Decisions

- **Not a duplicate** (checked 2026-10-16): the Gladys core master
  (0027571, 2026-10-16, 39 services) has nothing for Ajax or SIA
  (`server/services` and `front/src` have no `sia`, `ajax`, `dc09` file). The
  GitHub search finds no other Gladys Ajax or SIA integration (only this
  repo); among the 454 repos with the `gladys-assistant-integration` topic,
  none matches `ajax` or `sia`, and the alarm ones are other brands
  (guim31/gladys-diagral, -simplisafe, -ring; prohand/gladys-verisure,
  gladys-somfyprotect; LM1LC3N7/gladys-somfy-protexial). The main session
  checked the store index (433 entries) and the forum the same day: no claim
  but ours (/t/10385 post #224).
- **Own receiver, ported, no SIA dependency** (Louis's rule: reuse maintained
  work, rewrite dead or debt-heavy code):
  - npm has no standalone SIA DC-09 receiver library (searches `sia`,
    `dc09`, `dc-09`, `sia receiver`, 2026-10-16): only Node-RED nodes
    (node-red-contrib-sia-ultimate, node-red-sia-cert) and the
    ioBroker.sia adapter, which are plugins of those platforms.
  - [MoustacheOff/homebridge-ajax-sia](https://github.com/MoustacheOff/homebridge-ajax-sia)
    (MIT, Node, 1.1.2 of 2026-10-12, first published 2026-10-11, active,
    tested on a real Hub 2): its SIA code (`src/sia/*.ts`, ~530 lines) is
    clean and small, but it is a Homebridge plugin, not a library: no
    `exports`, TypeScript compiled to `dist/` with the Homebridge platform
    as `main`, one account only, refuses a link test whose pad has no `|`
    (pysiaalarm's real `*NULL` sample), and its API may change any day.
    Depending on it would pull a Homebridge plugin into the image for ~300
    lines. So its frame / receiver / server logic is **ported** (with its
    MIT notice) and extended: several accounts, ADM-CID, a pad without `|`,
    repeats, UDP and TCP on the same port.
  - [eavanvalkenburg/pysiaalarm](https://github.com/eavanvalkenburg/pysiaalarm)
    (MIT, Python, used by the Home Assistant core `sia` integration, last
    commit 2026-01-28): the protocol reference; its SIA code table (which
    merges the Ajax "OS Malevich" codes) and ADM-CID mapping are generated
    into `src/sia/codes.js`, its test frames are our fixtures. Its quirks are
    not copied: the `None` receiver echoed in replies when the panel sends no
    `R`, the unframed `"NAK"` for an unknown account, the DUH for any code
    missing from its table (here every readable code is acknowledged).
  - [schmupu/ioBroker.sia](https://github.com/schmupu/ioBroker.sia) (MIT,
    2.0.4 of 2025-11): read to compare the replies only.
    Runtime dependencies: the SDK only; `npm audit` clean (a dev-only
    brace-expansion advisory fixed with `npm audit fix`).
- **Sub-container + private-network channel**: the main container cannot
  publish a port; Gaetanb76/gladys-bresser-weather-station runs its receiver
  as a sub-container of the same image (`command`) and shares a file through
  a declared volume, polled by the main container. Here the hand-over is a
  TCP channel instead: the Gladys core joins the main container to the
  integration's private network where the sub-container answers by its name
  (`buildSubContainerDescriptor`: "the main container simply reaches
  `mqtt:1883`"), so events arrive at once, in order, with no file to clean;
  the receiver keeps a bounded queue while the main container is away. A
  token (random, kept in `/data`, passed in the receiver env) guards the
  channel. No volume declared.
- **Channel protocol 2 (after the 0.1.1 review)**: the token went in clear in
  the hello and the client trusted any `ready`. Now the handshake of
  LM1LC3N7/gladys-mystrom (mutual HMAC-SHA256 challenge-response, 16-byte
  nonces each side, nothing accepted before a verified `ready`, 10 s
  handshake timer, no connection with an empty secret), plus what mystrom
  does not have: every server line after the challenge is
  `{ seq, data, mac }` with `mac = HMAC(K, seq|data)`,
  `K = HMAC(token, session|Ns|Nc)`, `seq` growing by exactly one from 0 (the
  `ready`). `data` is the JSON string, so the MAC never depends on a
  re-serialization. Integrity only, no confidentiality (the network is
  private and the messages hold no secret). `CHANNEL_PROTOCOL: '2'` in the
  receiver env changes its hash, so `ensureReceiver` recreates a receiver
  still on the 0.1.1 image; the token stays in `/data`.
- **Receiver env, recreated only on change**: accounts, key bytes (hex),
  time skew, token, log level go in the env of `startContainer` (secrets
  never in the public manifest, as the SDK README says). Gladys recreates the
  container when the env changes; the main container skips `startContainer`
  when the receiver runs with the same env (fingerprint in `/data`), so a
  restart of the integration does not drop the hub's connection.
- **The receiver always runs**, even with no account: Gladys assigns the host
  port at the first start, and `{{port:sia}}` only resolves after it; a hub
  reporting with an unknown account is NAKed and named in the logs and the
  status button.
- **TCP and UDP on 7777**, two declared ports (`sia`, `sia_udp`): Gladys
  assigns them different host ports. Ajax documents neither; TCP is shown
  first.
- **Replies**: ACK echoes the sequence, the `R` field only when sent, the
  line and the account (header, else data); an encrypted message gets an
  encrypted ACK (`]_timestamp` left-padded with `0`, the pysiaalarm /
  homebridge-ajax-sia form); NAK is `"NAK"0000R0L0A0[]_timestamp`; DUH for
  an unsupported message type or unreadable data. A repeat within 5 minutes
  (same account, line, sequence and content, sequence ≠ 0000) is ACKed and
  flagged, not applied twice. The length field is not enforced (pysiaalarm's
  own samples get it wrong); the CRC is.
- **Keys**: one key for all accounts (one field; per-hub keys are milestone
  3). Ajax accepts 16 ASCII or 32 hex characters (AES-128): `auto` reads 32,
  48 or 64 hex digits as hex, other 16/24/32-character keys as text; a
  `key_format` select forces either (pysiaalarm reads every key as text).
  With a key, plain messages are refused.
- **Clock**: `time_skew` 60 s by default (homebridge-ajax-sia's default on a
  real Hub 2; DC-09 suggests +20/-40 s), 0 disables it. A timestamp that is
  not a date is refused when the check is on; no timestamp is accepted.
- **Mode = `text`/`select`** read-only (`disarmed`, `armed`, `night`,
  `partial`), as gladys-somfy-protexial and gladys-somfyprotect expose
  arming: the core has no alarm-panel category (its alarm modes belong to the
  house). Faults as core categories: `tamper`, `battery-low`, `input` for
  mains power, device link and hub reporting (1 = OK, as Protexial's links),
  `siren` binary for the alarm in progress, `text` for the groups and the
  last event.
- **Arming model** (Ajax table + homebridge-ajax-sia): `CL`-like codes arm the
  system, `CG`/`CB` and `OG`/`OB` a group (`ri`), `CF`/`AF` with a group
  once groups are in use; disarming one group of a fully armed system leaves
  the other known groups armed; `NL`-like codes night mode; `HA` (Ajax duress
  disarm) disarms and raises a duress alarm; `NC` is "night mode on
  automatically" for Ajax (a network condition in the SIA standard).
- **Alarms**: intrusion and code guessing raised while armed stay until a
  disarm (a door closing again — `BR` — does not end a burglary), otherwise
  their restore ends them; fire, heat, gas, water, freeze end with their
  restore only (a disarm does not clear a fire); panic, medical, duress end
  with their restore or a disarm. A restore without zone ends every alarm of
  its kind. The "clear" button empties alarms and faults by hand.
- **Supervision**: offline after 2 × the periodic test interval + 30 s
  without any message (one missed test tolerated), checked every 15 s;
  default interval 1 minute (the Ajax setting to choose), 0 = none. The
  connection status says what is missing (account, key, receiver, first
  message, silent hub).
- **States through `publishStates`**, only the changed ones plus the last
  event after any event (the brief: `publishChangedStates` would drop a
  repeated value), everything again every 30 minutes and after a device
  creation. **Scene events**: one per transition (`alarm` only for a new
  alarm of a zone), `sia_event` for every event but link tests; capped at
  240 per minute; none for messages kept more than 5 minutes by the receiver.
- **One-way**: `onSetValue` refuses; no scene action. Arming from Gladys would
  need the Ajax cloud (homebridge-ajax-sia's unofficial gRPC client): out of
  scope, said in the docs.
