# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-17

### Added

- LICENSE file (Apache-2.0, as declared in package.json), also copied into the
  image.

### Security

- The private channel between the receiver and the main container (port 7778)
  no longer sends its token in clear: both sides prove they know it with a
  mutual HMAC-SHA256 challenge-response on fresh 16-byte nonces, and the main
  container accepts nothing before the receiver has proved it. A fake receiver
  is refused, a recorded handshake cannot be replayed, and an empty secret
  never connects.
- Every line the receiver sends after the handshake carries a sequence number
  and an HMAC-SHA256 with a per-connection key derived from the nonces: an
  event injected, altered, replayed or reordered on the private network drops
  the connection instead of reaching Gladys. The content stays readable on the
  private network (integrity, not confidentiality).
- The receiver env gains `CHANNEL_PROTOCOL=2`, so a receiver still running the
  old image is recreated on the first start. The token stays in `/data`:
  nothing to reconfigure.

## [0.1.1] - 2026-10-16

### Added

- Ajax Systems alarms locally, over SIA DC-09: Gladys is the monitoring
  station of the hub, which sends its events straight to Gladys without the
  Ajax cloud.
- A `sia-receiver` sub-container (same image) publishing the SIA port in TCP
  and UDP; the configuration screen shows the address and port to enter in
  the Ajax app. It acknowledges the messages (ACK, NAK with its time, DUH),
  checks the CRC, the account, the encryption (AES-128, -192 or -256, key as
  text or hexadecimal) and the clock (60 s by default), and keeps the
  messages while the integration restarts.
- SIA-DCS and ADM-CID (Contact ID) messages, link tests (`NULL`, `RP`).
- One device per account (several hubs possible): mode (disarmed, armed,
  night mode, groups armed), alarm in progress, tamper, low battery, mains
  power, devices connected, hub reporting, armed groups and last event, in
  French or English.
- Supervision: a hub silent for two periodic tests is shown as such.
- Scene triggers "Ajax alarm", "Ajax arming changed", "Ajax fault", "Ajax
  alarm or fault over" and "Any Ajax event", with a hub filter.
- "Show the receiver status" and "Clear the alarm and fault memory" buttons.
- The state learned from the events is kept across restarts.

[Unreleased]: https://github.com/LM1LC3N7/gladys-ajax/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-ajax/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-ajax/releases/tag/v0.1.1
