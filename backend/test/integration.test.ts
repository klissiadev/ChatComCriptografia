import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server';
import type { EncryptedMessage, KeyUpdate, SendAck, StoredMessage } from '../../shared/types';

let srv: ReturnType<typeof createServer>;
let base: string;
const publicKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
}).publicKey.toString('base64');

beforeAll(async () => {
  srv = createServer({ dbFile: ':memory:', jwtSecret: 'test', corsOrigin: '*' });
  await new Promise<void>((r) => srv.httpServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.httpServer.address() as AddressInfo).port}`;
});
afterAll(() => srv.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, token?: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const fakeKey = () => Buffer.from(randomUUID().repeat(8)).toString('base64'); // o servidor não olha o conteúdo
const msg = (conversationId: string, keyVersion: number, id: string = randomUUID()): EncryptedMessage => ({
  id, conversationId, keyVersion, ciphertext: 'AAAA', iv: 'AAAAAAAAAAAAAAAA', signature: 'AAAA',
});

async function user(name: string) {
  const r = await api('/auth/register', undefined, 'POST', { username: `${name}_${randomUUID().slice(0, 6)}`, password: 'password123', publicKey });
  expect(r.status).toBe(201);
  return { id: r.body.user.id as string, token: r.body.token as string };
}

function client(token: string) {
  const messages: StoredMessage[] = [];
  const keys: KeyUpdate[] = [];
  const statuses: unknown[] = [];
  const s: Socket = ioc(base, { auth: { token }, autoConnect: false, transports: ['websocket'] });
  s.on('message:new', (m: StoredMessage) => messages.push(m));
  s.on('key:update', (k: KeyUpdate) => keys.push(k));
  s.on('message:status', (x: unknown) => statuses.push(x));
  return {
    s, messages, keys, statuses,
    connect: () => new Promise<void>((res, rej) => { s.once('connect', () => res()); s.once('connect_error', rej); s.connect(); }),
    send: (m: EncryptedMessage) => s.emitWithAck('message:send', m) as Promise<SendAck>,
  };
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('auth', () => {
  it('rejeita chave pública inválida e requisições sem token', async () => {
    const bad = await api('/auth/register', undefined, 'POST', { username: 'zed_user', password: 'password123', publicKey: 'AAAA' });
    expect(bad.status).toBe(400);
    expect((await api('/users')).status).toBe(401);
  });
});

describe('conversa de 2 pessoas', () => {
  it('entrega offline, ordena, deduplica e reentrega sem ACK', async () => {
    const alice = await user('alice');
    const bob = await user('bob');
    const conv = await api('/conversations', alice.token, 'POST', {
      memberIds: [bob.id],
      keys: [{ userId: alice.id, encryptedKey: fakeKey() }, { userId: bob.id, encryptedKey: fakeKey() }],
    });
    expect(conv.status).toBe(201);
    expect(conv.body.type).toBe('direct');
    const cid: string = conv.body.id;

    const a = client(alice.token);
    await a.connect();
    const m1 = msg(cid, 1), m2 = msg(cid, 1);
    const r1 = await a.send(m1), r2 = await a.send(m2), r1b = await a.send(m1); // bob está offline
    expect(r1).toMatchObject({ ok: true, duplicate: false });
    expect(r2).toMatchObject({ ok: true, duplicate: false });
    expect(r1b).toMatchObject({ ok: true, duplicate: true });
    if (r1.ok && r2.ok && r1b.ok) { expect(r2.seq).toBeGreaterThan(r1.seq); expect(r1b.seq).toBe(r1.seq); }

    const b = client(bob.token);
    await b.connect();
    await waitFor(() => b.messages.length === 2);
    expect(b.messages.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(b.keys).toHaveLength(1);

    b.s.emit('message:delivered', { messageId: m1.id }); // ACK só da m1
    await waitFor(() => a.statuses.length === 1);
    b.s.disconnect();

    const b2 = client(bob.token); // reconecta: m2 volta, m1 não
    await b2.connect();
    await waitFor(() => b2.messages.length === 1);
    expect(b2.messages[0].id).toBe(m2.id);

    const h = await api(`/conversations/${cid}/messages`, bob.token);
    expect(h.body.messages.map((m: StoredMessage) => m.id)).toEqual([m1.id, m2.id]);
    a.s.disconnect(); b2.s.disconnect();
  });

  it('não permite adicionar a conversa direta', async () => {
    const a = await user('a'), b = await user('b'), c = await user('c');
    const conv = await api('/conversations', a.token, 'POST', {
      memberIds: [b.id], keys: [{ userId: a.id, encryptedKey: fakeKey() }, { userId: b.id, encryptedKey: fakeKey() }],
    });
    const r = await api(`/conversations/${conv.body.id}/members`, a.token, 'POST', {
      userId: c.id, keyVersion: 2, keys: [a, b, c].map((u) => ({ userId: u.id, encryptedKey: fakeKey() })),
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('DIRECT_CANNOT_ADD');
  });
});

describe('grupo e rotação de chave', () => {
  it('removido não lê mensagens novas; chave antiga é recusada', async () => {
    const a = await user('ga'), b = await user('gb'), c = await user('gc');
    const keysFor = (...us: { id: string }[]) => us.map((u) => ({ userId: u.id, encryptedKey: fakeKey() }));
    const conv = await api('/conversations', a.token, 'POST', { name: 'g', memberIds: [b.id, c.id], keys: keysFor(a, b, c) });
    expect(conv.body.type).toBe('group');
    const cid: string = conv.body.id;

    const ca = client(a.token), cb = client(b.token), cc = client(c.token);
    await Promise.all([ca.connect(), cb.connect(), cc.connect()]);

    // conjunto de chaves errado / versão errada falham sem alterar nada
    const wrongSet = await api(`/conversations/${cid}/members/${c.id}`, a.token, 'DELETE', { keyVersion: 2, keys: keysFor(a) });
    expect(wrongSet.body.error).toBe('KEY_SET_MISMATCH');
    const wrongVer = await api(`/conversations/${cid}/members/${c.id}`, a.token, 'DELETE', { keyVersion: 5, keys: keysFor(a, b) });
    expect(wrongVer.body).toMatchObject({ error: 'STALE_KEY_VERSION', currentKeyVersion: 1 });
    expect((await api('/conversations', a.token)).body[0].keyVersion).toBe(1);

    const ok = await api(`/conversations/${cid}/members/${c.id}`, a.token, 'DELETE', { keyVersion: 2, keys: keysFor(a, b) });
    expect(ok.status).toBe(200);
    await waitFor(() => cb.keys.some((k) => k.keyVersion === 2));
    expect(cc.keys.some((k) => k.keyVersion === 2)).toBe(false);

    expect(await cc.send(msg(cid, 1))).toMatchObject({ ok: false, code: 'NOT_MEMBER' });
    expect(await cb.send(msg(cid, 1))).toMatchObject({ ok: false, code: 'STALE_KEY', currentKeyVersion: 2 });
    expect(await cb.send(msg(cid, 2))).toMatchObject({ ok: true });
    await waitFor(() => ca.messages.length === 1);
    expect(cc.messages).toHaveLength(0);
    expect((await api(`/conversations/${cid}/messages`, c.token)).status).toBe(403);
    [ca, cb, cc].forEach((x) => x.s.disconnect());
  });

  it('novo membro só recebe a chave nova e não vê histórico antigo', async () => {
    const a = await user('ha'), b = await user('hb'), c = await user('hc'), d = await user('hd');
    const keysFor = (...us: { id: string }[]) => us.map((u) => ({ userId: u.id, encryptedKey: fakeKey() }));
    const conv = await api('/conversations', a.token, 'POST', { name: 'g2', memberIds: [b.id, c.id], keys: keysFor(a, b, c) });
    const cid: string = conv.body.id;
    const ca = client(a.token); await ca.connect();
    await ca.send(msg(cid, 1));

    const add = await api(`/conversations/${cid}/members`, a.token, 'POST', { userId: d.id, keyVersion: 2, keys: keysFor(a, b, c, d) });
    expect(add.status).toBe(200);
    const keys = await api(`/conversations/${cid}/keys`, d.token);
    expect(keys.body.map((k: { keyVersion: number }) => k.keyVersion)).toEqual([2]);
    expect((await api(`/conversations/${cid}/messages`, d.token)).body.messages).toHaveLength(0);
    ca.s.disconnect();
  });
});
