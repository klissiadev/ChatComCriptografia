import type { DecryptedMessage, Message, Verification } from "./types"

const wait = () =>
  new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 600))

export const cryptoService = {
  async generateKeyPair(): Promise<{ publicKey: string privateKey: string }> {
    await wait()
    return {
      publicKey: `public_${crypto.randomUUID()}`,
      privateKey: `private_${crypto.randomUUID()}`,
    }
  },
  async createSessionKey(): Promise<string> {
    await wait()
    return `session_${crypto.randomUUID()}`
  },
  async encryptSessionKey(
    key: string,
    publicKeys: string[],
  ): Promise<string[]> {
    await wait()
    return publicKeys.map((publicKey) => btoa(`${key}:${publicKey}`))
  },
  async decryptSessionKey(encrypted: string): Promise<string> {
    await wait()
    return atob(encrypted).split(":")[0]
  },
  async encryptMessage(text: string, _conversationId: string) {
    await wait()
    return {
      iv: crypto.randomUUID().slice(0, 12),
      ciphertext: btoa(unescape(encodeURIComponent(text))),
      signature: `sig_${crypto.randomUUID()}`,
      keyVersion: 1,
    }
  },
  async decryptMessage(message: Message): Promise<{
    text: string
    verification: Verification
  }> {
    await wait()
    try {
      return {
        text: decodeURIComponent(escape(atob(message.ciphertext))),
        verification: "ok",
      }
    } catch {
      return { text: "", verification: "tampered" }
    }
  },
  async getFingerprint(publicKey: string): Promise<string> {
    const bytes = Array.from(new TextEncoder().encode(publicKey))
    return bytes
      .map((byte, index) =>
        ((byte * 17 + index * 13) % 256).toString(16).padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
      .slice(0, 32)
      .match(/.{1,4}/g)!
      .join(" ")
  },
}

export function asDecrypted(message: Message, text: string): DecryptedMessage {
  return { ...message, text, verification: "ok" }
}
