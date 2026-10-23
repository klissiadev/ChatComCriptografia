import type { CreateConversationBody, KeyUpdate, SessionKeyDTO, StoredMessage } from '../../../shared/types'
import { cryptoService, type KeyRecipient } from './cryptoService'

/** Adaptador de criptografia; request deve enviar JWT e rejeitar respostas HTTP de erro. */
export function createCryptoIntegration(userId: string, request: <T>(path: string, method?: string, body?: unknown) => Promise<T>) {
  const publicKey = (id: string) => request<{ publicKey: string }>(`/users/${id}/public-key`)
  const recipients = async (ids: string[]): Promise<KeyRecipient[]> => Promise.all(ids.map(async id => ({ userId: id, publicKey: (await publicKey(id)).publicKey })))
  return {
    async prepareConversation(memberIds: string[], name?: string): Promise<CreateConversationBody> {
      const ids = [...new Set([userId, ...memberIds])]
      if (ids.length < 2) throw new Error('Selecione outro participante')
      // O servidor atribui o ID definitivo; a cópia local é recuperada via /keys depois do POST.
      const keys = await cryptoService.distributeKey(crypto.randomUUID(), 1, await recipients(ids))
      return { name, memberIds: ids.filter(id => id !== userId), keys: keys.map(({ userId, encryptedKey }) => ({ userId, encryptedKey })) }
    },
    async prepareRotation(conversationId: string, currentVersion: number, remainingIds: string[]) {
      if (!remainingIds.length) return { keyVersion: currentVersion + 1, keys: [] }
      const keys = await cryptoService.rotateKey(conversationId, currentVersion + 1, await recipients(remainingIds))
      return { keyVersion: currentVersion + 1, keys: keys.map(({ userId, encryptedKey }) => ({ userId, encryptedKey })) }
    },
    async receiveKey(update: KeyUpdate) {
      await cryptoService.decryptSessionKey(update.encryptedKey, update.conversationId, update.keyVersion, userId)
      // O chamador emite key:ack somente após esta Promise resolver.
    },
    async syncKeys(conversationId: string, version?: number) {
      const keys = await request<SessionKeyDTO[]>(`/conversations/${conversationId}/keys${version ? `?version=${version}` : ''}`)
      for (const key of keys) await cryptoService.decryptSessionKey(key.encryptedKey, conversationId, key.keyVersion, userId)
    },
    async decrypt(message: StoredMessage) {
      const sender = await publicKey(message.senderId)
      const envelope = { ...message, serverTimestamp: message.createdAt, status: 'delivered' as const }
      let result = await cryptoService.decryptMessage(envelope, sender.publicKey, userId)
      if (result.verification === 'waiting_key') {
        await this.syncKeys(message.conversationId, message.keyVersion)
        result = await cryptoService.decryptMessage(envelope, sender.publicKey, userId)
      }
      return { ...envelope, ...result }
    },
  }
}
