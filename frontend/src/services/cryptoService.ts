import type { DecryptedMessage, Message, Verification } from "./types"

const DB_NAME = "cifra-crypto"
const DB_VERSION = 1
const IDENTITY_STORE = "identities"
const SESSION_STORE = "session-keys"
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type Identity = { id: string; privateKey: CryptoKey; signingPrivateKey: CryptoKey; exchangePublicKey: CryptoKey; signingPublicKey: CryptoKey }
type SessionKey = { id: string; conversationId: string; version: number; key: CryptoKey }
export type KeyRecipient = { userId: string; publicKey: string }
export type DistributedKey = { userId: string; encryptedKey: string; keyVersion: number }

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB não está disponível neste navegador"))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDENTITY_STORE)) db.createObjectStore(IDENTITY_STORE, { keyPath: "id" })
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o banco de chaves"))
  })
}

async function put<T>(store: string, value: T): Promise<void> {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite")
    tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("Não foi possível salvar a chave local"))
    tx.onabort = () => reject(tx.error ?? new Error("Salvamento da chave local cancelado"))
  })
  db.close()
}

async function get<T>(store: string, id: string): Promise<T | undefined> {
  const db = await database()
  const result = await new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(id)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error ?? new Error("Não foi possível ler a chave local"))
  })
  db.close()
  return result
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ""
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function identityId(userId?: string): string { return userId ?? "default" }
function sessionId(conversationId: string, version: number): string { return `${conversationId}:${version}` }

async function loadIdentity(userId?: string): Promise<Identity> {
  const identity = await get<Identity>(IDENTITY_STORE, identityId(userId)) ?? (userId ? await get<Identity>(IDENTITY_STORE, "default") : undefined)
  if (!identity) throw new Error("Chave privada não encontrada neste dispositivo. Entre ou gere suas chaves novamente.")
  return identity
}

async function loadSessionKey(conversationId: string, version: number): Promise<CryptoKey> {
  const session = await get<SessionKey>(SESSION_STORE, sessionId(conversationId, version))
  if (!session) throw new Error(`Chave da conversa indisponível (versão ${version})`)
  return session.key
}

function canonicalMessage(message: Pick<Message, "id" | "conversationId" | "senderId" | "keyVersion" | "iv" | "ciphertext">): Uint8Array {
  return encoder.encode(JSON.stringify({
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    keyVersion: message.keyVersion,
    iv: message.iv,
    ciphertext: message.ciphertext,
  }))
}

async function importPublicKey(serialized: string): Promise<CryptoKey> {
  const jwk = JSON.parse(serialized) as JsonWebKey
  if (jwk.kty !== "RSA" || jwk.n === undefined || jwk.e === undefined) throw new Error("Chave pública RSA inválida")
  return crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"])
}

async function importSigningKey(serialized: string): Promise<CryptoKey> {
  const jwk = JSON.parse(serialized) as JsonWebKey
  if (jwk.kty !== "RSA" || jwk.n === undefined || jwk.e === undefined) throw new Error("Chave de assinatura RSA inválida")
  return crypto.subtle.importKey("jwk", jwk, { name: "RSA-PSS", hash: "SHA-256" }, true, ["verify"])
}

export const cryptoService = {
  /** Gera RSA-OAEP para troca de chaves e RSA-PSS para assinatura. Privadas ficam no IndexedDB. */
  async generateKeyPair(userId?: string): Promise<{ publicKey: string }> {
    if (!globalThis.crypto?.subtle) throw new Error("Web Crypto exige HTTPS ou localhost em um navegador compatível")
    const [exchangePair, signingPair] = await Promise.all([
      crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]),
      crypto.subtle.generateKey({ name: "RSA-PSS", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]),
    ])
    const publicData = {
      version: 1,
      exchange: await crypto.subtle.exportKey("jwk", exchangePair.publicKey),
      signing: await crypto.subtle.exportKey("jwk", signingPair.publicKey),
    }
    const privateExchange = await crypto.subtle.importKey("jwk", await crypto.subtle.exportKey("jwk", exchangePair.privateKey), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"])
    const privateSigning = await crypto.subtle.importKey("jwk", await crypto.subtle.exportKey("jwk", signingPair.privateKey), { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"])
    await put<Identity>(IDENTITY_STORE, { id: identityId(userId), privateKey: privateExchange, signingPrivateKey: privateSigning, exchangePublicKey: exchangePair.publicKey, signingPublicKey: signingPair.publicKey })
    return { publicKey: JSON.stringify(publicData) }
  },

  async getPublicKey(userId?: string): Promise<string> {
    const identity = await get<Identity>(IDENTITY_STORE, identityId(userId))
    if (!identity) return ""
    // Public keys are reconstructed from their private counterpart's public JWK fields.
    const exchange = await crypto.subtle.exportKey("jwk", identity.exchangePublicKey)
    const signing = await crypto.subtle.exportKey("jwk", identity.signingPublicKey)
    return JSON.stringify({ version: 1, exchange, signing })
  },

  async createSessionKey(conversationId = "default", version = 1): Promise<string> {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
    await put<SessionKey>(SESSION_STORE, { id: sessionId(conversationId, version), conversationId, version, key })
    return sessionId(conversationId, version)
  },

  /** Criptografa a chave AES individualmente para cada membro e retorna os IDs dos destinatários. */
  async distributeKey(conversationId: string, version: number, members: KeyRecipient[]): Promise<DistributedKey[]> {
    if (members.length < 2) throw new Error("A conversa precisa ter pelo menos dois participantes")
    await this.createSessionKey(conversationId, version)
    const key = await loadSessionKey(conversationId, version)
    const raw = await crypto.subtle.exportKey("raw", key)
    return Promise.all(members.map(async ({ userId, publicKey }) => {
      const parsed = JSON.parse(publicKey) as { version?: number; exchange?: JsonWebKey }
      if (!parsed.exchange) throw new Error(`Chave de criptografia ausente para ${userId}`)
      const recipientKey = await importPublicKey(JSON.stringify(parsed.exchange))
      const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, recipientKey, raw)
      return { userId, encryptedKey: toBase64(encrypted), keyVersion: version }
    }))
  },

  async encryptSessionKey(keyRef: string, publicKeys: string[]): Promise<string[]> {
    const [conversationId, rawVersion] = keyRef.includes(":") ? keyRef.split(":") : ["default", "1"]
    const key = await loadSessionKey(conversationId, Number(rawVersion))
    const raw = await crypto.subtle.exportKey("raw", key)
    return Promise.all(publicKeys.map(async (publicKey) => {
      const parsed = JSON.parse(publicKey) as { exchange?: JsonWebKey }
      const recipient = await importPublicKey(JSON.stringify(parsed.exchange ?? parsed))
      return toBase64(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, recipient, raw))
    }))
  },

  async decryptSessionKey(encrypted: string, conversationId = "default", version = 1, userId?: string): Promise<string> {
    const identity = await loadIdentity(userId)
    const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, identity.privateKey, fromBase64(encrypted))
    const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
    await put<SessionKey>(SESSION_STORE, { id: sessionId(conversationId, version), conversationId, version, key })
    return sessionId(conversationId, version)
  },

  async rotateKey(conversationId: string, nextVersion: number, members: KeyRecipient[]): Promise<DistributedKey[]> {
    if (!Number.isInteger(nextVersion) || nextVersion < 1) throw new Error("Versão de chave inválida")
    return this.distributeKey(conversationId, nextVersion, members)
  },

  async encryptMessage(text: string, conversationId: string, keyVersion = 1, senderId = "default", messageId = crypto.randomUUID()) {
    const key = await loadSessionKey(conversationId, keyVersion)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const aad = encoder.encode(`${conversationId}:${keyVersion}`)
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, encoder.encode(text))
    const envelope = { id: messageId, conversationId, senderId, keyVersion, iv: toBase64(iv), ciphertext: toBase64(encrypted) }
    const identity = await loadIdentity(senderId)
    const signature = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, identity.signingPrivateKey, canonicalMessage(envelope))
    return { ...envelope, signature: toBase64(signature) }
  },

  async verifyMessage(message: Message, senderPublicKey: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(senderPublicKey) as { signing?: JsonWebKey }
      const signingKey = await importSigningKey(JSON.stringify(parsed.signing ?? parsed))
      return crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, signingKey, fromBase64(message.signature), canonicalMessage(message))
    } catch {
      return false
    }
  },

  async decryptMessage(message: Message, senderPublicKey?: string, userId?: string): Promise<{ text: string; verification: Verification }> {
    try {
      if (!senderPublicKey) return { text: "", verification: "waiting_key" }
      const valid = await this.verifyMessage(message, senderPublicKey)
      if (!valid) return { text: "", verification: "invalid_signature" }
      const key = await loadSessionKey(message.conversationId, message.keyVersion)
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(message.iv), additionalData: encoder.encode(`${message.conversationId}:${message.keyVersion}`), tagLength: 128 }, key, fromBase64(message.ciphertext))
      return { text: decoder.decode(decrypted), verification: "ok" }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Chave da conversa indisponível")) return { text: "", verification: "waiting_key" }
      return { text: "", verification: "tampered" }
    }
  },

  async getFingerprint(publicKey: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(publicKey))
    return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("").match(/.{1,4}/g)!.join(" ")
  },
}

export function asDecrypted(message: Message, text: string): DecryptedMessage {
  return { ...message, text, verification: "ok" }
}
