// -----------------------------------------------------------------------------
// The receiver service of the `sia-receiver` sub-container: the SIA listeners
// and the channel to the main container, configured from the environment the
// main container passes to startContainer:
//
//   SIA_ACCOUNTS    JSON [{ "account": "1234", "key": "<hex of the AES key>|''" }]
//   SIA_TIME_SKEW   allowed clock difference in seconds (0 = not checked)
//   CHANNEL_TOKEN   the secret the main container says hello with
//   SIA_PORT        7777 (TCP and UDP, published by Gladys on host ports)
//   CHANNEL_PORT    7778 (private network only)
// -----------------------------------------------------------------------------

import { CHANNEL_PORT, createChannelServer } from '../channel.js';
import { SiaReceiver } from './receiver.js';
import { SiaServer } from './server.js';

export const SIA_PORT = 7777;
/** The same refusal (reason + account) is reported to the main container once per minute. */
const REJECTION_REPORT_MS = 60_000;
const STATUS_EVERY_MS = 60_000;

/** SIA_ACCOUNTS -> Map(account -> { key: Buffer|null }); invalid entries are skipped. */
export function parseAccountsEnv(text, logger) {
  const accounts = new Map();
  let list = [];
  try {
    list = JSON.parse(text || '[]');
  } catch {
    logger?.error('SIA_ACCOUNTS is not valid JSON: no account accepted');
  }
  for (const entry of Array.isArray(list) ? list : []) {
    const account = String(entry?.account ?? '').toUpperCase();
    const key = String(entry?.key ?? '');
    if (!/^[0-9A-F]{3,16}$/.test(account)) continue;
    if (key !== '' && !/^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{48}|[0-9a-fA-F]{64})$/.test(key)) {
      logger?.error(`Account ${account}: invalid key, account skipped`);
      continue;
    }
    accounts.set(account, { key: key === '' ? null : Buffer.from(key, 'hex') });
  }
  return accounts;
}

/**
 * @param {object} options
 * @param {object} options.env process.env-like
 * @param {object} [options.logger]
 * @param {() => Date} [options.now]
 * @returns {Promise<{ server: SiaServer, channel: object, stop(): Promise }>}
 */
export async function startReceiverService({ env = process.env, logger, now } = {}) {
  const accounts = parseAccountsEnv(env.SIA_ACCOUNTS, logger);
  const timeSkew = Math.max(0, Number(env.SIA_TIME_SKEW ?? 0) || 0);
  const port = Number(env.SIA_PORT ?? SIA_PORT);
  const startedAt = new Date().toISOString();
  const receiver = new SiaReceiver({ accounts, timeSkew, now });
  const server = new SiaServer({
    receiver,
    port,
    udpPort: Number(env.SIA_UDP_PORT ?? port),
    logger,
  });
  const status = () => ({
    startedAt,
    accounts: [...accounts.keys()],
    encrypted: [...accounts].filter(([, entry]) => entry.key).map(([account]) => account),
    timeSkew,
    stats: { ...server.stats, panels: server.sockets.size },
  });
  const channel = createChannelServer({
    port: Number(env.CHANNEL_PORT ?? CHANNEL_PORT),
    token: env.CHANNEL_TOKEN,
    logger,
    hello: status,
  });

  const reported = new Map();
  server.on('message', (message) => {
    // Link tests come every minute or so: debug only.
    const log = message.events.length > 0 ? logger?.info : logger?.debug;
    log?.call(
      logger,
      `Account ${message.account}: ${message.id}${message.duplicate ? ' (repeat)' : ''} ${
        message.events.map((event) => `${event.code}${event.number ?? ''}`).join(' ') || 'link test'
      } from ${message.remote}`,
    );
    channel.send({ type: 'message', receivedAt: new Date().toISOString(), ...message });
  });
  server.on('rejected', (rejection) => {
    logger?.warn(`Refused a message from ${rejection.remote}: ${rejection.problem}`);
    const key = `${rejection.reason}:${rejection.account ?? ''}`;
    const last = reported.get(key) ?? 0;
    if (Date.now() - last >= REJECTION_REPORT_MS) {
      reported.set(key, Date.now());
      channel.send({ type: 'rejected', at: new Date().toISOString(), ...rejection });
    }
  });
  server.on('error', (err) => logger?.error('SIA listener error', err));

  await channel.start();
  await server.start();
  logger?.info(
    `SIA DC-09 receiver on TCP and UDP port ${server.tcpPort} for ${
      accounts.size === 0 ? 'no account yet' : `account(s) ${[...accounts.keys()].join(', ')}`
    }; channel on port ${channel.port}`,
  );
  const timer = setInterval(
    () => channel.send({ type: 'status', ...status() }, { queue: false }),
    STATUS_EVERY_MS,
  );
  timer.unref?.();

  return {
    server,
    channel,
    async stop() {
      clearInterval(timer);
      await server.stop();
      await channel.stop();
    },
  };
}
