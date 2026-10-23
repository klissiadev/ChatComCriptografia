import type {
  ConversationDTO,
  EncryptedKeyEntry,
  HistoryResponse,
  PublicKeyDTO,
  StoredMessage,
  UserDTO,
} from "../../../shared/types"
import { fetchPublicKey, getCryptoIntegration, rememberPublicKeys } from "./backend.ts"
import { cryptoService } from "./cryptoService"
import { ApiError, request } from "./http.ts"
import { getSession } from "./session.ts"
import { socketService } from "./socketService"
import type { Conversation, DecryptedMessage, Message, User } from "./types"

type Rotation = { keyVersion: number; keys: EncryptedKeyEntry[] }

function me(): User {
  const session = getSession()
  if (!session) throw new Error("Sessão expirada. Entre novamente.")
  return session.user
}

async function onlineSet(): Promise<Set<string>> {
  const users = await request<UserDTO[]>("/users")
  return new Set(users.filter((user) => user.online).map((user) => user.id))
}

/** ConversationDTO -> Conversation da UI. Tenta recuperar do servidor a chave que faltar localmente. */
async function toConversation(dto: ConversationDTO, online: Set<string>): Promise<Conversation> {
  const myId = me().id
  const other = dto.members.find((member) => member.userId !== myId)

  let keyPending = !(await cryptoService.hasSessionKey(dto.id, dto.keyVersion))
  if (keyPending) {
    try {
      await getCryptoIntegration().syncKeys(dto.id, dto.keyVersion)
    } catch {
      /* continua pendente; uma nova listagem tenta de novo */
    }
    keyPending = !(await cryptoService.hasSessionKey(dto.id, dto.keyVersion))
  }

  return {
    id: dto.id,
    type: dto.type,
    name: dto.type === "direct" ? (other?.username ?? dto.name ?? "Conversa") : (dto.name ?? "Grupo"),
    participants: dto.members.map((member) => ({
      userId: member.userId,
      role: member.role,
      online: member.userId === myId || online.has(member.userId) || socketService.isOnline(member.userId),
    })),
    keyVersion: dto.keyVersion,
    createdBy: dto.createdBy,
    unread: 0,
    keyPending,
  }
}

async function fetchDto(conversationId: string): Promise<ConversationDTO> {
  const list = await request<ConversationDTO[]>("/conversations")
  const dto = list.find((item) => item.id === conversationId)
  if (!dto) throw new Error("Conversa não encontrada")
  return dto
}

async function loadConversation(conversationId: string): Promise<Conversation> {
  const [dto, online] = await Promise.all([fetchDto(conversationId), onlineSet()])
  return toConversation(dto, online)
}

/**
 * Monta a rotação de chave com a versão atual do servidor e envia.
 * Em STALE_KEY_VERSION (alguém rotacionou antes), refaz com a versão nova. Até 3 tentativas.
 */
async function rotate<T>(
  conversationId: string,
  nextMembers: (current: string[]) => string[],
  send: (rotation: Rotation) => Promise<T>,
): Promise<T> {
  const integration = getCryptoIntegration()
  for (let attempt = 1; ; attempt++) {
    const dto = await fetchDto(conversationId)
    const rotation = await integration.prepareRotation(
      conversationId,
      dto.keyVersion,
      nextMembers(dto.members.map((member) => member.userId)),
    )
    try {
      return await send(rotation)
    } catch (error) {
      // O servidor não aceitou esta chave: não pode ficar guardada como se fosse a versão oficial.
      await cryptoService.discardSessionKey(conversationId, rotation.keyVersion)
      if (error instanceof ApiError && error.code === "STALE_KEY_VERSION" && attempt < 3) {
        await integration.syncKeys(conversationId).catch(() => undefined)
        continue
      }
      throw error
    }
  }
}

function unreadable(stored: StoredMessage): DecryptedMessage {
  return {
    id: stored.id,
    conversationId: stored.conversationId,
    senderId: stored.senderId,
    keyVersion: stored.keyVersion,
    iv: stored.iv,
    ciphertext: stored.ciphertext,
    signature: stored.signature,
    serverTimestamp: stored.createdAt,
    seq: stored.seq,
    status: "delivered",
    text: "",
    verification: "waiting_key",
  }
}

export const apiService = {
  async listUsers(): Promise<User[]> {
    const list = await request<UserDTO[]>("/users")
    for (let i = 0; i < list.length; i += 50) {
      const ids = list.slice(i, i + 50).map((user) => user.id)
      rememberPublicKeys(await request<PublicKeyDTO[]>(`/users/public-keys?ids=${ids.join(",")}`))
    }
    const users = await Promise.all(
      list.map(async (user) => ({ id: user.id, username: user.username, publicKey: await fetchPublicKey(user.id) })),
    )
    return [me(), ...users] // como no mock, a lista inclui o próprio usuário
  },

  getPublicKey(userId: string): Promise<string> {
    return fetchPublicKey(userId)
  },

  async listConversations(): Promise<Conversation[]> {
    const [dtos, online] = await Promise.all([request<ConversationDTO[]>("/conversations"), onlineSet()])
    return Promise.all(dtos.map((dto) => toConversation(dto, online)))
  },

  /** Histórico já decifrado e verificado, em ordem de seq. `beforeSeq` filtra no cliente. */
  async getHistory(conversationId: string, beforeSeq?: number): Promise<DecryptedMessage[]> {
    const integration = getCryptoIntegration()
    await integration.syncKeys(conversationId).catch(() => undefined) // todas as versões de uma vez
    const all: StoredMessage[] = []
    let afterSeq = 0
    for (;;) {
      const page = await request<HistoryResponse>(
        `/conversations/${conversationId}/messages?afterSeq=${afterSeq}&limit=200`,
      )
      all.push(...page.messages)
      if (!page.hasMore || page.messages.length === 0) break
      afterSeq = page.messages[page.messages.length - 1].seq
    }
    const selected = beforeSeq === undefined ? all : all.filter((message) => message.seq < beforeSeq)
    return Promise.all(selected.map((stored) => integration.decrypt(stored).catch(() => unreadable(stored))))
  },

  /** Decifra e verifica uma mensagem recebida pelo socket. Lança erro em falha de rede (não confirme o ACK). */
  decryptMessage(message: Message): Promise<DecryptedMessage> {
    const stored: StoredMessage = {
      id: message.id,
      conversationId: message.conversationId,
      keyVersion: message.keyVersion,
      ciphertext: message.ciphertext,
      iv: message.iv,
      signature: message.signature,
      seq: message.seq,
      senderId: message.senderId,
      createdAt: message.serverTimestamp,
    }
    return getCryptoIntegration().decrypt(stored)
  },

  /** Após um ack STALE_KEY: baixa as chaves novas e devolve a conversa com a keyVersion atual. */
  resyncKeys(conversationId: string): Promise<Conversation> {
    return loadConversation(conversationId)
  },

  async createConversation(participantIds: string[], name?: string): Promise<Conversation> {
    const integration = getCryptoIntegration()
    const isGroup = participantIds.length > 1
    const body = await integration.prepareConversation(
      participantIds,
      isGroup ? name?.trim() || "Novo grupo" : undefined,
    )
    const dto = await request<ConversationDTO>("/conversations", "POST", body)
    await integration.syncKeys(dto.id) // recupera a cópia local da chave v1 antes de enviar mensagens
    return loadConversation(dto.id)
  },

  /**
   * Em grupo: rotaciona a chave e adiciona. Em conversa direta o servidor não permite:
   * cria uma NOVA conversa com todos (o histórico fica na original). Confira se o id retornado difere.
   */
  async addMember(conversationId: string, userId: string): Promise<Conversation> {
    const dto = await fetchDto(conversationId)
    if (dto.type === "direct") {
      const others = dto.members.map((member) => member.userId).filter((id) => id !== me().id)
      return this.createConversation([...others, userId])
    }
    await rotate(
      conversationId,
      (members) => [...members, userId],
      (rotation) => request(`/conversations/${conversationId}/members`, "POST", { userId, ...rotation }),
    )
    return loadConversation(conversationId)
  },

  async removeMember(conversationId: string, userId: string): Promise<void> {
    await rotate(
      conversationId,
      (members) => members.filter((id) => id !== userId),
      (rotation) => request(`/conversations/${conversationId}/members/${userId}`, "DELETE", rotation),
    )
  },

  async leaveConversation(conversationId: string): Promise<void> {
    const myId = me().id
    await rotate(
      conversationId,
      (members) => members.filter((id) => id !== myId),
      (rotation) => request(`/conversations/${conversationId}/members/me`, "DELETE", rotation),
    )
  },
}