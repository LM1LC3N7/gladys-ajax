// -----------------------------------------------------------------------------
// The SIA DC-09 listeners: TCP (what Ajax hubs use, one connection kept open
// unless "Connect on demand" is on) and UDP (one message per datagram), both
// on the same container port. Every message goes through the SiaReceiver; its
// reply is sent back on the same socket. Structure after homebridge-ajax-sia
// (MIT, see THIRD_PARTY_NOTICES.md).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';

/** Panels open one connection each; a stale one is dropped for a new one past this. */
const MAX_CONNECTIONS = 16;
/** A message is a few hundred bytes: past this without a <CR>, it is garbage. */
const MAX_BUFFERED = 4096;

/** Emits `message` (accepted), `rejected` ({ reason, problem, account, remote }) and `error`. */
export class SiaServer extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('./receiver.js').SiaReceiver} options.receiver
   * @param {number} options.port
   * @param {string} [options.host]
   * @param {boolean} [options.udp] listen on UDP too (default true)
   * @param {number} [options.udpPort] the UDP port (default: the TCP one)
   * @param {object} [options.logger]
   */
  constructor({ receiver, port, udpPort = port, host = '0.0.0.0', udp = true, logger }) {
    super();
    this.receiver = receiver;
    this.port = port;
    this.host = host;
    this.withUdp = udp;
    this.udpPortWanted = udpPort;
    this.logger = logger;
    this.sockets = new Set();
    this.stats = { connections: 0, messages: 0, accepted: 0, rejected: 0 };
  }

  async start() {
    await this.startTcp();
    if (this.withUdp) {
      await this.startUdp();
    }
  }

  async stop() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await Promise.all([
      new Promise((resolve) => (this.tcp ? this.tcp.close(() => resolve()) : resolve())),
      new Promise((resolve) => (this.udp ? this.udp.close(() => resolve()) : resolve())),
    ]);
    this.tcp = undefined;
    this.udp = undefined;
  }

  get tcpPort() {
    return this.tcp?.address()?.port;
  }

  get udpPort() {
    return this.udp?.address()?.port;
  }

  startTcp() {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.accept(socket));
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        server.on('error', (err) => this.emit('error', err));
        this.tcp = server;
        resolve();
      });
    });
  }

  startUdp() {
    return new Promise((resolve, reject) => {
      const socket = createSocket('udp4');
      socket.once('error', reject);
      socket.on('message', (data, remote) => {
        const text = data.toString('latin1');
        for (const line of text.split('\r')) {
          const reply = this.handle(line, `udp:${remote.address}`);
          if (reply) {
            socket.send(Buffer.from(reply, 'latin1'), remote.port, remote.address);
          }
        }
      });
      socket.bind(this.udpPortWanted, this.host, () => {
        socket.off('error', reject);
        socket.on('error', (err) => this.emit('error', err));
        this.udp = socket;
        resolve();
      });
    });
  }

  accept(socket) {
    if (this.sockets.size >= MAX_CONNECTIONS) {
      // Keep the newest: a panel that reconnects leaves its dead socket behind.
      const [oldest] = this.sockets;
      oldest.destroy();
      this.sockets.delete(oldest);
    }
    const remote = `tcp:${socket.remoteAddress?.replace(/^::ffff:/, '')}`;
    this.sockets.add(socket);
    this.stats.connections += 1;
    this.logger?.debug(`Panel connected (${remote})`);
    socket.setKeepAlive(true, 60_000);
    socket.setNoDelay(true);
    socket.setEncoding('latin1');

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const reply = this.handle(line, remote);
        if (reply && !socket.destroyed) {
          socket.write(reply, 'latin1');
        }
      }
      if (buffer.length > MAX_BUFFERED) {
        this.logger?.warn(`Dropping the connection of ${remote}: message too long`);
        socket.destroy();
      }
    });
    socket.on('error', (err) => this.logger?.debug(`Socket error (${remote}): ${err.message}`));
    socket.on('close', () => {
      this.sockets.delete(socket);
      this.logger?.debug(`Panel disconnected (${remote})`);
    });
  }

  /** One message through the receiver; returns the reply to send. */
  handle(raw, remote) {
    const line = raw.replace(/^[\r\n\0]+|[\r\n\0]+$/g, '');
    if (line === '') {
      return null;
    }
    this.stats.messages += 1;
    this.logger?.debug(`<- ${remote} ${JSON.stringify(line)}`);
    const result = this.receiver.receive(line);
    if (result.message) {
      this.stats.accepted += 1;
      this.emit('message', { ...result.message, remote });
    } else {
      this.stats.rejected += 1;
      this.emit('rejected', {
        reason: result.reason,
        problem: result.problem,
        account: result.account,
        remote,
      });
    }
    if (result.reply) {
      this.logger?.debug(`-> ${remote} ${JSON.stringify(result.reply)}`);
    }
    return result.reply;
  }
}
