import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
// IndexedDB mínimo para testes unitários; dados e CryptoKeys passam por structuredClone.
const stores = new Map()
const db = {
  objectStoreNames: { contains: name => stores.has(name) },
  createObjectStore(name) { stores.set(name, new Map()) },
  close() {},
  transaction(name) {
    const tx = { objectStore() { return {
      put(value) { stores.get(name).set(value.id, structuredClone(value)); setTimeout(() => tx.oncomplete?.(), 0) },
      get(id) { const req = {}; setTimeout(() => { req.result = structuredClone(stores.get(name).get(id)); req.onsuccess?.() }, 0); return req },
    } } }
    return tx
  },
}
globalThis.indexedDB = { open() { const req = { result: db }; setTimeout(() => { req.onupgradeneeded?.(); req.onsuccess?.() }, 0); return req } }
const source = stripTypeScriptTypes(readFileSync(new URL('../src/services/cryptoService.ts', import.meta.url), 'utf8'))
const { cryptoService: c } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

test('RSA + AES: roundtrip, assinatura, adulteração, rotação, versões e IVs', async () => {
  const a = await c.generateKeyPair('alice')
  const b = await c.generateKeyPair('bob')
  const members = [{ userId: 'alice', publicKey: a.publicKey }, { userId: 'bob', publicKey: b.publicKey }]
  const keys = await c.distributeKey('chat', 1, members)
  const first = await c.encryptMessage('segredo', 'chat', 1, 'alice', 'id1')
  stores.get('session-keys').clear()
  await c.decryptSessionKey(keys[1].encryptedKey, 'chat', 1, 'bob')
  assert.deepEqual(await c.decryptMessage(first, a.publicKey), { text: 'segredo', verification: 'ok' })
  assert.equal(await c.verifyMessage(first, b.publicKey), false)
  assert.equal(await c.verifyMessage({ ...first, ciphertext: 'AAAA' }, a.publicKey), false)
  assert.equal(await c.verifyMessage({ ...first, conversationId: 'outro' }, a.publicKey), false)
  assert.equal((await c.decryptMessage({ ...first, signature: 'AAAA' }, a.publicKey)).verification, 'invalid_signature')
  const forged = { ...first, ciphertext: btoa('mensagem adulterada') }
  const signedFields = { id: forged.id, conversationId: forged.conversationId, senderId: forged.senderId, keyVersion: forged.keyVersion, iv: forged.iv, ciphertext: forged.ciphertext }
  forged.signature = Buffer.from(await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, stores.get('identities').get('alice').signingPrivateKey, new TextEncoder().encode(JSON.stringify(signedFields)))).toString('base64')
  assert.equal((await c.decryptMessage(forged, a.publicKey)).verification, 'tampered')
  const next = await c.rotateKey('chat', 2, [members[0]])
  assert.equal(next.length, 1)
  await assert.rejects(c.decryptSessionKey(next[0].encryptedKey, 'chat', 2, 'bob'))
  assert.equal((await c.decryptMessage(first, a.publicKey)).text, 'segredo')
  const ivs = new Set()
  for (let i = 0; i < 100; i++) ivs.add((await c.encryptMessage('x', 'chat', 2, 'alice')).iv)
  assert.equal(ivs.size, 100)
  await assert.rejects(c.distributeKey('chat', 2, members))
  await assert.rejects(c.encryptMessage('x', 'chat', 2, 'unknown'))
  stores.get('session-keys').clear()
  assert.equal((await c.decryptMessage(first, a.publicKey)).verification, 'waiting_key')
})
