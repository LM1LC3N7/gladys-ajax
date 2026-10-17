// -----------------------------------------------------------------------------
// The link between the two containers: JSON lines over TCP on the private
// network of the integration (Gladys gives the receiver the DNS alias
// `sia-receiver`, and joins the main container to that network). The port is
// not published: only the main container reaches it.
//
// - the receiver runs the server: it keeps what the panels sent while the main
//   container is away (a bounded queue) and streams it once a client has
//   proved it knows the channel secret;
// - the main container runs the client: it reconnects by itself, and accepts
//   nothing before the server has proved it knows the secret too.
//
// Protocol 2. Mutual challenge-response, the secret never on the wire:
//   server -> { type: 'challenge', nonce: Ns }
//   client -> { type: 'hello', nonce: Nc, proof: HMAC(secret, 'client|Ns|Nc') }
//   server -> { type: 'ready', proof: HMAC(secret, 'server|Nc|Ns'),
//               seq: 0, data: '<info JSON>', mac }
//   server -> { seq: 1, 2, ..., data: '<message JSON>', mac }
// Fresh 16-byte nonces on both sides: a recorded exchange cannot be replayed.
// Every server line after the challenge carries
//   mac = HMAC(K, 'seq|data'), K = HMAC(secret, 'session|Ns|Nc')
// and `seq` must grow by exactly one: a line injected, altered, replayed,
// reordered or taken from another session drops the connection. This gives
// authenticity and integrity, not confidentiality: the content stays readable
// on the private network.
//
// Sub-containers get no Gladys credentials: the receiver only ever talks to
// the panels and to this channel. Handshake ported from LM1LC3N7/gladys-mystrom
// (same author, Apache-2.0).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CHANNEL_PORT = 7778;
export const CHANNEL_PROTOCOL = '2';
const MAX_LINE = 64 * 1024;
const NONCE = /^[0-9a-f]{32}$/;
const HANDSHAKE_TIMEOUT = 10_000;

const nonce = () => randomBytes(16).toString('hex');

const hmac = (key, text) => createHmac('sha256', key).update(text).digest('hex');

export const proof = (secret, role, first, second) =>
  hmac(String(secret ?? ''), `${role}|${first}|${second}`);

/** The per-connection key of the message MACs. */
export const sessionKey = (secret, serverNonce, clientNonce) =>
  createHmac('sha256', String(secret ?? ''))
    .update(`session|${serverNonce}|${clientNonce}`)
    .digest();

export const messageMac = (key, seq, data) => hmac(key, `${seq}|${data}`);

/** A server line after the challenge: the object as a JSON string, numbered and MACed. */
export function seal(key, seq, object, extra = {}) {
  const data = JSON.stringify(object);
  return { ...extra, seq, data, mac: messageMac(key, seq, data) };
}

const sameProof = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

/** Splits a socket's data into JSON objects; drops the socket on garbage. */
function onJsonLines(socket, handler) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim() === '') continue;
      let object;
      try {
        object = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }
      handler(object);
      if (socket.destroyed) return;
    }
    if (buffer.length > MAX_LINE) {
      socket.destroy();
    }
  });
}

/**
 * Receiver side.
 * @returns {{ start(): Promise, stop(): Promise, send(object): void, port: number, connected: boolean }}
 */
export function createChannelServer({
  port = CHANNEL_PORT,
  host = '0.0.0.0',
  token,
  queueSize = 500,
  logger,
  hello = () => ({}),
}) {
  const queue = [];
  let client; // { socket, key, seq }
  let server;
  let dropped = 0;
  const secret = String(token ?? '');

  const writeRaw = (socket, object) => socket?.write(`${JSON.stringify(object)}\n`);
  const writeSealed = (session, object, extra) => {
    writeRaw(session.socket, seal(session.key, session.seq, object, extra));
    session.seq += 1;
  };

  const channel = {
    get port() {
      return server?.address()?.port;
    },
    get connected() {
      return Boolean(client);
    },
    /** Sends now, or queues while no client is connected (unless `queue` is false). */
    send(object, { queue: keep = true } = {}) {
      if (client) {
        writeSealed(client, object);
        return;
      }
      if (!keep) return;
      queue.push(object);
      if (queue.length > queueSize) {
        queue.shift();
        dropped += 1;
      }
    },
    start() {
      if (secret === '') {
        // Without a secret no proof means anything: every client is refused.
        logger?.error('Channel: no secret (CHANNEL_TOKEN), every client will be refused');
      }
      return new Promise((resolve, reject) => {
        server = createServer((socket) => {
          socket.setKeepAlive(true, 30_000);
          let state = 'challenged';
          const serverNonce = nonce();
          const timer = setTimeout(() => state === 'ready' || socket.destroy(), HANDSHAKE_TIMEOUT);
          writeRaw(socket, { type: 'challenge', nonce: serverNonce });
          onJsonLines(socket, (object) => {
            if (state === 'ready') return; // the main container sends nothing else
            const valid =
              secret !== '' &&
              object?.type === 'hello' &&
              NONCE.test(String(object.nonce ?? '')) &&
              sameProof(object.proof, proof(secret, 'client', serverNonce, object.nonce));
            if (!valid) {
              logger?.warn('Channel: refused a client that does not know the secret');
              socket.destroy();
              return;
            }
            state = 'ready';
            clearTimeout(timer);
            if (client && client.socket !== socket) client.socket.destroy();
            client = { socket, key: sessionKey(secret, serverNonce, object.nonce), seq: 0 };
            writeSealed(
              client,
              { queued: queue.length, dropped, ...hello() },
              { type: 'ready', proof: proof(secret, 'server', object.nonce, serverNonce) },
            );
            while (queue.length > 0) writeSealed(client, queue.shift());
            dropped = 0;
            logger?.info('Channel: main container connected');
          });
          socket.on('error', () => {});
          socket.on('close', () => {
            clearTimeout(timer);
            if (client?.socket === socket) {
              client = undefined;
              logger?.info('Channel: main container disconnected, keeping messages');
            }
          });
        });
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    stop() {
      client?.socket.destroy();
      return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
  };
  return channel;
}

/**
 * Main container side: emits `message` (each object), `up` and `down`.
 * Reconnects with a 1 s to 30 s backoff.
 */
export class ChannelClient extends EventEmitter {
  constructor({
    host = 'sia-receiver',
    port = CHANNEL_PORT,
    token,
    logger,
    delays = [1000, 2000, 5000, 10_000, 30_000],
    handshakeTimeout = HANDSHAKE_TIMEOUT,
  }) {
    super();
    this.host = host;
    this.port = port;
    this.secret = String(token ?? '');
    this.logger = logger;
    this.delays = delays;
    this.handshakeTimeout = handshakeTimeout;
    this.attempt = 0;
    this.connected = false;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.destroy();
    this.socket = undefined;
  }

  connect() {
    if (this.stopped) return;
    if (this.secret === '') {
      // Without a secret no proof means anything: never connect.
      this.logger?.error('Channel: no secret, not connecting to the receiver');
      this.stopped = true;
      return;
    }
    const socket = createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setKeepAlive(true, 30_000);
    let state = 'waiting';
    let clientNonce;
    let serverNonce;
    let key;
    let expected = 0;
    // A receiver that stalls the handshake is dropped (and tried again later).
    const handshake = setTimeout(() => {
      if (state !== 'ready') {
        this.logger?.debug('Channel: handshake timed out');
        socket.destroy();
      }
    }, this.handshakeTimeout);
    handshake.unref?.();
    socket.on('close', () => clearTimeout(handshake));
    /** The object of a sealed line, or undefined (and the socket dropped). */
    const open = (line) => {
      const valid =
        line?.seq === expected &&
        typeof line.data === 'string' &&
        sameProof(line.mac, messageMac(key, expected, line.data));
      if (!valid) {
        this.logger?.warn('Channel: dropped a message without a valid MAC or out of sequence');
        socket.destroy();
        return undefined;
      }
      expected += 1;
      try {
        const object = JSON.parse(line.data);
        if (object !== null && typeof object === 'object') return object;
      } catch {
        // fall through
      }
      socket.destroy();
      return undefined;
    };
    onJsonLines(socket, (object) => {
      if (state === 'waiting') {
        if (object?.type !== 'challenge' || !NONCE.test(String(object.nonce ?? ''))) {
          socket.destroy();
          return;
        }
        serverNonce = object.nonce;
        clientNonce = nonce();
        key = sessionKey(this.secret, serverNonce, clientNonce);
        state = 'hello';
        socket.write(
          `${JSON.stringify({
            type: 'hello',
            nonce: clientNonce,
            proof: proof(this.secret, 'client', serverNonce, clientNonce),
          })}\n`,
        );
        return;
      }
      if (state === 'hello') {
        // Nothing is accepted before a ready that proves the receiver knows the secret.
        if (
          object?.type !== 'ready' ||
          !sameProof(object.proof, proof(this.secret, 'server', clientNonce, serverNonce))
        ) {
          this.logger?.warn('Channel: the receiver did not prove it knows the secret');
          socket.destroy();
          return;
        }
        const info = open(object);
        if (!info) return;
        state = 'ready';
        clearTimeout(handshake);
        this.connected = true;
        this.attempt = 0;
        this.emit('up', info);
        return;
      }
      const message = open(object);
      if (message) this.emit('message', message);
    });
    socket.on('error', (err) => this.logger?.debug(`Channel: ${err.message}`));
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.connected) {
        this.connected = false;
        this.emit('down');
      }
      if (!this.stopped) {
        const delay = this.delays[Math.min(this.attempt, this.delays.length - 1)];
        this.attempt += 1;
        this.timer = setTimeout(() => this.connect(), delay);
        this.timer.unref?.();
      }
    });
  }
}
