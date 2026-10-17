// -----------------------------------------------------------------------------
// The private channel, protocol 2: mutual HMAC challenge-response (the secret
// never on the wire), then a MAC and a sequence number on every line of the
// receiver. Raw sockets play the impostors. 127.0.0.1 only, ephemeral ports.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import {
  CHANNEL_PROTOCOL,
  ChannelClient,
  createChannelServer,
  messageMac,
  proof,
  seal,
  sessionKey,
} from '../src/channel.js';

const HOST = '127.0.0.1';
const SECRET = 'channel-secret';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads JSON lines from a socket. */
function lines(socket) {
  const received = [];
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      received.push(JSON.parse(buffer.slice(0, end)));
      buffer = buffer.slice(end + 1);
    }
  });
  return received;
}

const until = async (predicate, timeout = 3000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await wait(5);
  }
};

async function channelServer(t, options = {}) {
  const server = createChannelServer({ port: 0, host: HOST, token: SECRET, ...options });
  await server.start();
  t.after(() => server.stop());
  return server;
}

/** A raw client that does the handshake by hand. */
async function rawHandshake(t, port, clientNonce = 'a'.repeat(32)) {
  const socket = createConnection({ host: HOST, port });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  const received = lines(socket);
  await once(socket, 'connect');
  await until(() => received.length > 0);
  const [challenge] = received;
  socket.write(
    `${JSON.stringify({
      type: 'hello',
      nonce: clientNonce,
      proof: proof(SECRET, 'client', challenge.nonce, clientNonce),
    })}\n`,
  );
  return { socket, received, challenge, clientNonce };
}

/** A fake receiver: answers the hello correctly (or not), then runs `after`. */
async function fakeReceiver(t, { knowsSecret = true, after = () => {} } = {}) {
  const sockets = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    const serverNonce = 'd'.repeat(32);
    socket.write(`${JSON.stringify({ type: 'challenge', nonce: serverNonce })}\n`);
    const received = lines(socket);
    const timer = setInterval(() => {
      if (received.length === 0) return;
      clearInterval(timer);
      const { nonce: clientNonce } = received[0];
      const secret = knowsSecret ? SECRET : 'guessed';
      const key = sessionKey(secret, serverNonce, clientNonce);
      const write = (object) => socket.write(`${JSON.stringify(object)}\n`);
      write(
        seal(
          key,
          0,
          { queued: 0 },
          { type: 'ready', proof: proof(secret, 'server', clientNonce, serverNonce) },
        ),
      );
      after({ socket, key, write });
    }, 5);
    socket.on('close', () => clearInterval(timer));
  });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  t.after(() => {
    sockets.forEach((socket) => socket.destroy());
    server.close();
  });
  return server.address().port;
}

function client(t, port, options = {}) {
  const channel = new ChannelClient({
    host: HOST,
    port,
    token: SECRET,
    delays: [10_000],
    ...options,
  });
  const events = [];
  channel.on('up', (info) => events.push(['up', info]));
  channel.on('message', (message) => events.push(['message', message]));
  channel.on('down', () => events.push(['down']));
  t.after(() => channel.stop());
  return { channel, events };
}

test('protocol version 2', () => {
  assert.equal(CHANNEL_PROTOCOL, '2');
});

test('a valid handshake: both sides prove the secret, which never goes on the wire', async (t) => {
  const server = await channelServer(t, { hello: () => ({ accounts: ['1234'] }) });
  server.send({ type: 'message', account: '1234' });
  const { received, challenge, clientNonce } = await rawHandshake(t, server.port);
  assert.equal(challenge.type, 'challenge');
  assert.match(challenge.nonce, /^[0-9a-f]{32}$/);
  await until(() => received.length >= 3);
  const [, ready, queued] = received;
  assert.equal(ready.type, 'ready');
  assert.equal(ready.proof, proof(SECRET, 'server', clientNonce, challenge.nonce));
  const key = sessionKey(SECRET, challenge.nonce, clientNonce);
  assert.equal(ready.seq, 0);
  assert.equal(ready.mac, messageMac(key, 0, ready.data));
  assert.deepEqual(JSON.parse(ready.data), { queued: 1, dropped: 0, accounts: ['1234'] });
  assert.equal(queued.seq, 1, 'the queue only after the handshake, numbered');
  assert.equal(queued.mac, messageMac(key, 1, queued.data));
  assert.equal(JSON.parse(queued.data).type, 'message');
  assert.ok(!JSON.stringify(received).includes(SECRET));
  assert.equal(server.connected, true);

  // And the real client end to end.
  const other = await channelServer(t, { hello: () => ({ accounts: ['1234'] }) });
  const { channel, events } = client(t, other.port);
  channel.start();
  await once(channel, 'up');
  other.send({ type: 'message', n: 1 });
  other.send({ type: 'status', n: 2 });
  await until(() => events.length === 3);
  assert.deepEqual(events, [
    ['up', { queued: 0, dropped: 0, accounts: ['1234'] }],
    ['message', { type: 'message', n: 1 }],
    ['message', { type: 'status', n: 2 }],
  ]);
});

test('the server refuses a client without the secret, and a replayed hello', async (t) => {
  const server = await channelServer(t);
  server.send({ type: 'message', account: '1234' });
  // The real client with a wrong secret.
  const { channel, events } = client(t, server.port, { token: 'wrong' });
  channel.start();
  await wait(200);
  assert.deepEqual(events, []);
  assert.equal(server.connected, false);
  // A hello recorded from another session (proof for another challenge).
  const socket = createConnection({ host: HOST, port: server.port });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  const received = lines(socket);
  await once(socket, 'connect');
  await until(() => received.length > 0);
  socket.write(
    `${JSON.stringify({
      type: 'hello',
      nonce: 'b'.repeat(32),
      proof: proof(SECRET, 'client', 'c'.repeat(32), 'b'.repeat(32)),
    })}\n`,
  );
  await once(socket, 'close');
  assert.deepEqual(
    received.map((m) => m.type),
    ['challenge'],
    'nothing of the queue to it',
  );
  assert.equal(server.connected, false);
});

test('the client refuses a fake receiver: wrong proof, or messages before any ready', async (t) => {
  const port = await fakeReceiver(t, {
    knowsSecret: false,
    after: ({ key, write }) => write(seal(key, 1, { type: 'message', account: '1234' })),
  });
  const { channel, events } = client(t, port);
  channel.start();
  await wait(200);
  assert.deepEqual(events, []);
  assert.equal(channel.connected, false);

  // Messages without any handshake (protocol 1 style, or an impostor).
  const early = createServer((socket) => {
    socket.on('error', () => {});
    socket.write(`${JSON.stringify({ type: 'ready', queued: 0 })}\n`);
    socket.write(`${JSON.stringify({ type: 'message', account: '1234' })}\n`);
  });
  await new Promise((resolve) => early.listen(0, HOST, resolve));
  t.after(() => early.close());
  const second = client(t, early.address().port);
  second.channel.start();
  await wait(200);
  assert.deepEqual(second.events, []);
});

test('after the handshake: an injected line without a valid MAC drops the connection', async (t) => {
  const port = await fakeReceiver(t, {
    after: ({ key, write }) => {
      write(seal(key, 1, { type: 'message', n: 1 }));
      // Injected by someone without the session key.
      write({
        seq: 2,
        data: JSON.stringify({ type: 'message', n: 'forged' }),
        mac: 'f'.repeat(64),
      });
      write(seal(key, 3, { type: 'message', n: 3 }));
    },
  });
  const { channel, events } = client(t, port);
  channel.start();
  await until(() => events.some(([kind]) => kind === 'down'));
  assert.deepEqual(
    events.map(([kind, payload]) => [kind, payload?.n]),
    [
      ['up', undefined],
      ['message', 1],
      ['down', undefined],
    ],
  );
  // A plain (protocol 1) message after the ready is refused too.
  const plain = await fakeReceiver(t, {
    after: ({ write }) => write({ type: 'message', n: 'plain' }),
  });
  const other = client(t, plain);
  other.channel.start();
  await until(() => other.events.some(([kind]) => kind === 'down'));
  assert.deepEqual(
    other.events.map(([kind]) => kind),
    ['up', 'down'],
  );
});

test('after the handshake: an altered message is refused', async (t) => {
  const port = await fakeReceiver(t, {
    after: ({ key, write }) => {
      const line = seal(key, 1, { type: 'message', events: [{ code: 'BA' }] });
      write({ ...line, data: line.data.replace('BA', 'CL') });
    },
  });
  const { channel, events } = client(t, port);
  channel.start();
  await until(() => events.some(([kind]) => kind === 'down'));
  assert.deepEqual(
    events.map(([kind]) => kind),
    ['up', 'down'],
  );
});

test('after the handshake: a replayed or reordered message is refused', async (t) => {
  const port = await fakeReceiver(t, {
    after: ({ key, write }) => {
      const first = seal(key, 1, { type: 'message', n: 1 });
      write(first);
      write(first); // the same line again
    },
  });
  const { channel, events } = client(t, port);
  channel.start();
  await until(() => events.some(([kind]) => kind === 'down'));
  assert.deepEqual(
    events.map(([kind, payload]) => [kind, payload?.n]),
    [
      ['up', undefined],
      ['message', 1],
      ['down', undefined],
    ],
  );

  // A line skipping ahead (seq 2 before 1) is refused as well.
  const skip = await fakeReceiver(t, {
    after: ({ key, write }) => write(seal(key, 2, { type: 'message', n: 2 })),
  });
  const other = client(t, skip);
  other.channel.start();
  await until(() => other.events.some(([kind]) => kind === 'down'));
  assert.deepEqual(
    other.events.map(([kind]) => kind),
    ['up', 'down'],
  );
});

test('a message recorded in one session is refused in the next one', async (t) => {
  // Session keys differ with the nonces: a valid line of session A, sent in
  // session B with the same sequence number, does not verify.
  const keyA = sessionKey(SECRET, 'd'.repeat(32), 'a'.repeat(32));
  const recorded = seal(keyA, 1, { type: 'message', n: 'recorded' });
  const port = await fakeReceiver(t, { after: ({ write }) => write(recorded) });
  const { channel, events } = client(t, port);
  channel.start();
  await until(() => events.some(([kind]) => kind === 'down'));
  assert.deepEqual(
    events.map(([kind]) => kind),
    ['up', 'down'],
  );
});

test('an empty secret: the client never connects, the server refuses everyone', async (t) => {
  let connections = 0;
  const listener = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise((resolve) => listener.listen(0, HOST, resolve));
  t.after(() => listener.close());
  for (const token of ['', undefined]) {
    const { channel } = client(t, listener.address().port, { token });
    channel.start();
  }
  await wait(100);
  assert.equal(connections, 0);

  const server = await channelServer(t, { token: '' });
  server.send({ type: 'message' });
  const socket = createConnection({ host: HOST, port: server.port });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  const received = lines(socket);
  await once(socket, 'connect');
  await until(() => received.length > 0);
  // The proof an attacker can compute with an empty key.
  socket.write(
    `${JSON.stringify({
      type: 'hello',
      nonce: 'a'.repeat(32),
      proof: proof('', 'client', received[0].nonce, 'a'.repeat(32)),
    })}\n`,
  );
  await once(socket, 'close');
  assert.deepEqual(
    received.map((m) => m.type),
    ['challenge'],
  );
  assert.equal(server.connected, false);
});

test('the client drops a receiver that stalls the handshake', async (t) => {
  let closed = 0;
  const stalling = createServer((socket) => {
    socket.on('error', () => {});
    socket.on('close', () => {
      closed += 1;
    });
  });
  await new Promise((resolve) => stalling.listen(0, HOST, resolve));
  t.after(() => stalling.close());
  const { channel } = client(t, stalling.address().port, { handshakeTimeout: 50 });
  channel.start();
  await wait(300);
  assert.equal(closed, 1);
  assert.equal(channel.connected, false);
});
