# gladys-ajax

[Gladys Assistant](https://gladysassistant.com) external integration for
**Ajax Systems** alarms, **locally over SIA DC-09**: Gladys becomes the
monitoring station of the hub, which sends its events straight to Gladys on
the local network, without the Ajax cloud. The arming state (armed, night
mode, groups, disarmed), the alarms in progress (intrusion, fire, heat, gas,
water, panic, medical, duress), the faults (tamper, batteries, mains power,
device connections), the hub supervision from its periodic tests, the last
event, and scene triggers (alarm, arming change, fault, restore, any event).
SIA is one-way reporting: arming from Gladys is out of scope. Other panels
speaking SIA DC-09 (SIA-DCS or ADM-CID) may work too. Unofficial, not
affiliated with Ajax Systems.

User documentation: [docs/fr.md](docs/fr.md) · [docs/en.md](docs/en.md).

> **Work in progress (0.1, not published to the store yet).** Tested against
> a SIA DC-09 transmitter simulator (plain and AES-encrypted messages over TCP
> and UDP, against the real receiver container), not yet with a real Ajax hub.
> Feedback and bug reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-ajax/issues).

## How it works

```
Ajax hub ──SIA DC-09 (TCP/UDP, AES)──▶ sia-receiver container ──JSON lines, private network──▶ main container ──SDK──▶ Gladys
           host port chosen by Gladys   src/receiver.js                                          index.js
                                        ├─ src/sia/server.js    TCP / UDP listeners               ├─ src/app.js      AjaxApp
                                        ├─ src/sia/receiver.js  ACK / NAK / DUH decisions         ├─ src/model.js    events -> state (pure)
                                        ├─ src/sia/frame.js     CRC, AES, timestamps              ├─ src/devices.js  -> devices and states (pure)
                                        ├─ src/sia/content.js   data block, events                └─ src/store.js    /data/ajax-state.json
                                        └─ src/channel.js       queue + channel server
```

- **Two containers, one image**: the main container cannot publish a port, so
  the manifest declares a `sia-receiver` sub-container running the same image
  with `node src/receiver.js`, publishing port 7777 in TCP (`{{port:sia}}`)
  and UDP (`{{port:sia_udp}}`). The configuration screen shows the address to
  enter in the Ajax app with these placeholders and `{{gladys_host}}`.
- **Hand-over**: Gladys joins the main container to the private network of
  the integration, where the sub-container answers as `sia-receiver`. The
  receiver serves a channel there (port 7778, never published): JSON lines,
  opened by a hello with a token the main container generated and passed in
  the receiver's environment. The receiver keeps the last 500 messages while
  the main container is away.
- **Receiver environment** (`startContainer('sia-receiver', { env })`):
  `SIA_ACCOUNTS` (accounts and the AES key bytes as hex), `SIA_TIME_SKEW`,
  `CHANNEL_TOKEN`, `LOG_LEVEL`. Gladys recreates the container when it
  changes; the main container only calls `startContainer` when the receiver
  is not running or its environment changed (fingerprint kept in `/data`).
- **Protocol**: CRC-16/ARC, `"SIA-DCS"`, `"ADM-CID"` and `"NULL"` messages,
  AES-128/192/256-CBC with a zero IV (pad up to `|`, or up to `]` for a link
  test), ACK echoing sequence, receiver, line and account (encrypted when the
  message was, `]_timestamp` padded with `0`), NAK with the receiver's
  timestamp for a CRC error, an unknown account, a key problem or a clock
  outside the allowed skew, DUH for what cannot be read. A repeat (same
  sequence and content) is acknowledged again but not counted twice.
- **Model**: one device per account; the state is learned from the events
  (SIA only reports changes) and saved in `/data`. Arming per system or Ajax
  group (`ri`), night mode, alarms (intrusion latched while armed until a
  disarm, fire / gas / water until their restore), faults per device number,
  supervision from the periodic tests (`RP` / `NULL`).
- **States** go through `publishStates` (an event repeats values;
  `publishChangedStates` would drop them), only the changed ones plus the
  last event; everything again every 30 minutes. **Scene events** at most
  240 per minute, none for messages older than 5 minutes.

## Development

```bash
npm install
npm test                                        # node --test, no network but loopback
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
e2e/run.sh                                      # real image, receiver container, SIA client (Docker)
```

`test/fixtures/frames.js` holds SIA DC-09 lines from pysiaalarm's tests;
`test/helpers/siaClient.js` is an independent SIA transmitter (pysiaalarm's
test encoder transcribed: CRC, AES, plain and encrypted lines, TCP and UDP),
used by the unit tests over loopback and by `e2e/`, which builds the image,
runs the receiver read-only under its manifest limits, sends real frames
(plain and encrypted, TCP and UDP) and checks the ACKs, then runs the main
app inside the image (read-only, 256 MB, 0.5 CPU) against the SDK's fake
Gladys connected to that receiver.

## Credits

The SIA DC-09 receiver is our own, ported in part from these projects (MIT,
notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)); see
[TODO.md](TODO.md), Decisions, for why none is a dependency:

- [eavanvalkenburg/pysiaalarm](https://github.com/eavanvalkenburg/pysiaalarm)
  (MIT, © 2021 E.A. van Valkenburg), the library of the Home Assistant core
  `sia` integration: the protocol reference (CRC, encryption, replies), the
  SIA code table merged with the Ajax "OS Malevich" codes and the ADM-CID
  mapping (`src/sia/codes.js`), the frames of its tests (fixtures);
- [MoustacheOff/homebridge-ajax-sia](https://github.com/MoustacheOff/homebridge-ajax-sia)
  (MIT, © 2026 Gabriel Corral), a Node SIA DC-09 receiver run on a real Ajax
  Hub 2: frame, AES and reply handling, the TCP / UDP listener, the arming
  and alarm rules, and the Ajax setup steps;
- [schmupu/ioBroker.sia](https://github.com/schmupu/ioBroker.sia) (MIT), read
  to compare the replies;
- Ajax Systems' documentation "How to use SIA for CMS connection" and its
  SIA code table for OS Malevich 2.8 / 2.9.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest (the `sia-receiver` sub-container
follows the image), rolls `CHANGELOG.md`, tags, builds the multi-arch image to
GHCR and publishes the GitHub Release. The `gladys-assistant-integration`
topic is added at the first real release only.

## License

Apache-2.0, with MIT-licensed parts listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Ajax and Ajax Systems are
trademarks of Ajax Systems; this project is not affiliated with Ajax Systems.
