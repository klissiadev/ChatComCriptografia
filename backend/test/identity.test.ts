import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertPublicIdentity } from '../src/validation';
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
describe('identidade pública do cliente', () => {
  it('aceita dois pares e rejeita material privado e chave compartilhada', () => {
    const a = pair(), b = pair();
    const identity = { version: 1, exchange: a.publicKey.export({ format: 'jwk' }), signing: b.publicKey.export({ format: 'jwk' }) };
    expect(() => assertPublicIdentity(JSON.stringify(identity))).not.toThrow();
    expect(() => assertPublicIdentity(JSON.stringify({ ...identity, exchange: a.privateKey.export({ format: 'jwk' }) }))).toThrow();
    expect(() => assertPublicIdentity(JSON.stringify({ ...identity, signing: identity.exchange }))).toThrow();
    expect(() => assertPublicIdentity(JSON.stringify({ ...identity, version: 2 }))).toThrow();
  });
});
