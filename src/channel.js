// -----------------------------------------------------------------------------
// The link between the two containers: JSON lines over TCP on the private
// network of the integration (Gladys gives the receiver the DNS alias
// `sia-receiver`, and joins the main container to that network). The port is
// not published: only the main container reaches it.
//
// - the receiver runs the server: it keeps what the panels sent while the main
//   container is away (a bounded queue) and streams it once a client says
//   hello with the token both got from the main container;
// - the main container runs the client: it reconnects by itself.
//
// Sub-containers get no Gladys credentials: the receiver only ever talks to
// the panels and to this channel.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

export const CHANNEL_PORT = 7778;
const MAX_LINE = 64 * 1024;

const sameToken = (a, b) => {
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
  let client;
  let server;
  let dropped = 0;

  const write = (object) => client?.write(`${JSON.stringify(object)}\n`);

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
        write(object);
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
      return new Promise((resolve, reject) => {
        server = createServer((socket) => {
          socket.setKeepAlive(true, 30_000);
          let authenticated = false;
          const timer = setTimeout(() => authenticated || socket.destroy(), 10_000);
          onJsonLines(socket, (object) => {
            if (authenticated) return; // the main container never sends anything else
            if (object?.type !== 'hello' || !sameToken(object.token, token)) {
              logger?.warn('Channel: refused a client without the right token');
              socket.destroy();
              return;
            }
            authenticated = true;
            clearTimeout(timer);
            if (client && client !== socket) client.destroy();
            client = socket;
            write({ type: 'ready', queued: queue.length, dropped, ...hello() });
            while (queue.length > 0) write(queue.shift());
            dropped = 0;
            logger?.info('Channel: main container connected');
          });
          socket.on('error', () => {});
          socket.on('close', () => {
            clearTimeout(timer);
            if (client === socket) {
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
      client?.destroy();
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
  }) {
    super();
    this.host = host;
    this.port = port;
    this.token = token;
    this.logger = logger;
    this.delays = delays;
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
    const socket = createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setKeepAlive(true, 30_000);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ type: 'hello', token: this.token })}\n`);
    });
    onJsonLines(socket, (object) => {
      if (object?.type === 'ready' && !this.connected) {
        this.connected = true;
        this.attempt = 0;
        this.emit('up', object);
        return;
      }
      this.emit('message', object);
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
