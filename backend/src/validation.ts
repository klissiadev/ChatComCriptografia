import { createPublicKey } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './errors';

export const b64 = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const keyEntrySchema = z.object({
  userId: z.string().uuid(),
  encryptedKey: b64(1400), // RSA-OAEP até 4096 bits = 512 bytes ≈ 684 chars
});

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  keyVersion: z.number().int().min(1),
  ciphertext: b64(200_000),
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/), // 12 bytes
  signature: b64(1400),
});

/** Garante que a chave pública enviada é um SPKI RSA >= 2048 bits. */
export function assertRsaSpki(publicKeyB64: string): void {
  try {
    const k = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    if (k.asymmetricKeyType !== 'rsa' || (k.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
  } catch {
    throw new HttpError(400, 'INVALID_PUBLIC_KEY', 'publicKey must be a base64 SPKI RSA key of at least 2048 bits');
  }
}

/** Identidade pública com pares distintos para troca e assinatura. */
export function assertPublicIdentity(serialized: string): void {
  if (!serialized.startsWith('{')) return assertRsaSpki(serialized);
  try {
    const identity = JSON.parse(serialized);
    if (identity.version !== 1) throw new Error();
    for (const [field, algorithm] of [['exchange', 'RSA-OAEP-256'], ['signing', 'PS256']]) {
      const jwk = identity[field];
      if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e ||
          ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((f) => f in jwk) ||
          (jwk.alg && jwk.alg !== algorithm)) throw new Error();
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    }
    if (identity.exchange.n === identity.signing.n) throw new Error();
  } catch {
    throw new HttpError(400, 'INVALID_PUBLIC_KEY', 'Expected public RSA-OAEP/RSA-PSS identity version 1');
  }
}
