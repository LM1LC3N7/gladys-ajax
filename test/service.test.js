// -----------------------------------------------------------------------------
// The receiver service over loopback: SIA frames in on TCP and UDP, ACKs out,
// messages and refusals through the channel to a client like the main
// container's. 127.0.0.1 only, ephemeral ports.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { ChannelClient, createChannelServer } from '../src/channel.js';
import { startReceiverService } from '../src/sia/service.js';
import {
  buildLine,
  frame,
  parseReply,
  sendTcp,
  sendUdp,
  siaTimestamp,
} from './helpers/siaClient.js';

const KEY = Buffer.from('0123456789ABCDEF', 'latin1');
const HOST = '127.0.0.1';

async function start(t, env = {}) {
  const service = await startReceiverService({
    env: {
      SIA_ACCOUNTS: JSON.stringify([
        { account: '1234', key: '' },
        { account: 'AB12', key: KEY.toString('hex') },
      ]),
      SIA_TIME_SKEW: '60',
      CHANNEL_TOKEN: 'secret-token',
      SIA_PORT: '0',
      SIA_UDP_PORT: '0',
      CHANNEL_PORT: '0',
      ...env,
    },
  });
  t.after(() => service.stop());
  return service;
}

function client(t, port, token = 'secret-token') {
  const channel = new ChannelClient({ host: HOST, port, token, delays: [50] });
  const messages = [];
  channel.on('message', (message) => messages.push(message));
  t.after(() => channel.stop());
  return { channel, messages };
}

const waitFor = async (predicate, timeout = 3000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('TCP: several messages on one connection, each acknowledged, all forwarded', async (t) => {
  const service = await start(t);
  const { channel, messages } = client(t, service.channel.port);
  channel.start();
  const [ready] = await once(channel, 'up');
  assert.deepEqual(ready.accounts, ['1234', 'AB12']);
  assert.deepEqual(ready.encrypted, ['AB12']);

  const replies = await sendTcp(HOST, service.server.tcpPort, [
    buildLine({ account: '1234', sequence: '0001', content: '#1234|Nri1/CL5]' }),
    buildLine({ account: 'AB12', key: KEY, sequence: '0002', content: '|#AB12|Nri0/BA3]' }),
    buildLine({ account: '1234', type: 'NULL', sequence: '0000', content: ']' }),
  ]);
  assert.deepEqual(
    replies.map((reply) => parseReply(reply, KEY).verdict),
    ['ACK', 'ACK', 'ACK'],
  );
  assert.equal(parseReply(replies[1], KEY).encrypted, true);
  await waitFor(() => messages.length === 3);
  assert.deepEqual(
    messages.map((message) => [message.type, message.account, message.events.length]),
    [
      ['message', '1234', 1],
      ['message', 'AB12', 1],
      ['message', '1234', 0],
    ],
  );
  assert.match(messages[0].remote, /^tcp:127\.0\.0\.1$/);
  assert.ok(messages[0].receivedAt);
});

test('UDP: one message per datagram, the reply to the sender', async (t) => {
  const service = await start(t);
  const reply = await sendUdp(
    HOST,
    service.server.udpPort,
    buildLine({ account: '1234', content: '#1234|Nri1/OP5]' }),
  );
  assert.equal(parseReply(reply).verdict, 'ACK');
  assert.equal(service.server.stats.accepted, 1);
});

test('a message split across TCP packets, and a refusal reported to the main container', async (t) => {
  const service = await start(t);
  const { channel, messages } = client(t, service.channel.port);
  channel.start();
  await once(channel, 'up');
  const line = frame(buildLine({ account: '9999', content: '#9999|Nri1/CL1]' }));
  const socket = createConnection({ host: HOST, port: service.server.tcpPort });
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  socket.setEncoding('latin1');
  socket.write(line.slice(0, 10));
  await new Promise((resolve) => setTimeout(resolve, 20));
  socket.write(line.slice(10));
  const [reply] = await once(socket, 'data');
  assert.equal(parseReply(reply).verdict, 'NAK');
  await waitFor(() => messages.length === 1);
  assert.equal(messages[0].type, 'rejected');
  assert.equal(messages[0].reason, 'unknown_account');
  assert.equal(messages[0].account, '9999');
  // The same refusal again within a minute is not reported twice.
  socket.write(line);
  await once(socket, 'data');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(messages.length, 1);
});

test('the receiver keeps the messages while the main container is away', async (t) => {
  const service = await start(t);
  await sendTcp(HOST, service.server.tcpPort, [
    buildLine({ account: '1234', sequence: '0001', content: '#1234|Nri1/BA3]' }),
    buildLine({ account: '1234', sequence: '0002', content: '#1234|Nri1/OP5]' }),
  ]);
  const { channel, messages } = client(t, service.channel.port);
  channel.start();
  const [ready] = await once(channel, 'up');
  assert.equal(ready.queued, 2);
  await waitFor(() => messages.length === 2);
  assert.deepEqual(
    messages.map((message) => message.events[0].code),
    ['BA', 'OP'],
  );
});

test('the channel refuses a client without the token', async (t) => {
  const service = await start(t);
  const { channel } = client(t, service.channel.port, 'wrong');
  let up = false;
  channel.on('up', () => (up = true));
  channel.start();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(up, false);
  assert.equal(service.channel.connected, false);
});

test('a too long line without <CR> drops the connection', async (t) => {
  const service = await start(t);
  const socket = createConnection({ host: HOST, port: service.server.tcpPort });
  await once(socket, 'connect');
  socket.on('error', () => {});
  socket.write('X'.repeat(5000));
  await once(socket, 'close');
});

test('the oldest connection gives way past 16 panels', async (t) => {
  const service = await start(t);
  const sockets = [];
  t.after(() => sockets.forEach((socket) => socket.destroy()));
  for (let i = 0; i < 17; i++) {
    const socket = createConnection({ host: HOST, port: service.server.tcpPort });
    socket.on('error', () => {});
    sockets.push(socket);
    await once(socket, 'connect');
  }
  await waitFor(() => sockets[0].destroyed || sockets[0].readyState === 'closed');
  await waitFor(() => service.server.sockets.size === 16);
});

test('the channel queue is bounded', async (t) => {
  const server = createChannelServer({ port: 0, host: HOST, token: 't', queueSize: 3 });
  await server.start();
  t.after(() => server.stop());
  for (let i = 0; i < 5; i++) server.send({ type: 'message', i });
  server.send({ type: 'status' }, { queue: false });
  const { channel, messages } = client(t, server.port, 't');
  channel.start();
  const [ready] = await once(channel, 'up');
  assert.equal(ready.queued, 3);
  assert.equal(ready.dropped, 2);
  await waitFor(() => messages.length === 3);
  assert.deepEqual(
    messages.map((message) => message.i),
    [2, 3, 4],
  );
});

test('the client reconnects after the receiver restarts', async (t) => {
  const server = createChannelServer({ port: 0, host: HOST, token: 't' });
  await server.start();
  const port = server.port;
  const { channel, messages } = client(t, port, 't');
  channel.start();
  await once(channel, 'up');
  await server.stop();
  await once(channel, 'down');
  const again = createChannelServer({ port, host: HOST, token: 't' });
  await again.start();
  t.after(() => again.stop());
  await once(channel, 'up');
  again.send({ type: 'status', n: 1 });
  await waitFor(() => messages.length === 1);
});

test('invalid SIA_ACCOUNTS entries are skipped', async (t) => {
  const service = await start(t, {
    SIA_ACCOUNTS: JSON.stringify([
      { account: '12', key: '' },
      { account: 'C0FFEE', key: 'nothex' },
      { account: 'beef', key: '' },
    ]),
  });
  const reply = await sendUdp(
    HOST,
    service.server.udpPort,
    buildLine({ account: 'BEEF', content: '#BEEF|Nri1/CL1]', timestamp: siaTimestamp() }),
  );
  assert.equal(parseReply(reply).verdict, 'ACK');
});
