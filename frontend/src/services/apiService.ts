import { conversations, history, users } from "./mockData"
import type { Conversation, DecryptedMessage, User } from "./types"

const wait = () =>
  new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 600))
const occasionallyFail = () => {
  if (Math.random() < 0.035)
    throw new Error("Falha simulada ao consultar o servidor")
}

export const apiService = {
  async listUsers(): Promise<User[]> {
    await wait()
    occasionallyFail()
    return [...users]
  },
  async getPublicKey(userId: string): Promise<string> {
    await wait()
    return users.find((user) => user.id === userId)?.publicKey ?? ""
  },
  async listConversations(): Promise<Conversation[]> {
    await wait()
    occasionallyFail()
    return conversations.map((conversation) => ({ ...conversation }))
  },
  async getHistory(
    conversationId: string,
    _beforeSeq?: number,
  ): Promise<DecryptedMessage[]> {
    await wait()
    occasionallyFail()
    return [...(history[conversationId] ?? [])]
  },
  async createConversation(
    participantIds: string[],
    name?: string,
  ): Promise<Conversation> {
    await wait()
    const direct = participantIds.length === 1
    const participant = users.find((user) => user.id === participantIds[0])
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      type: direct ? "direct" : "group",
      name: direct
        ? (participant?.username ?? "Nova conversa")
        : name || "Novo grupo",
      participants: [
        { userId: "u1", role: "admin", online: true },
        ...participantIds.map((userId) => ({
          userId,
          role: "member" as const,
          online: true,
        })),
      ],
      keyVersion: 1,
      createdBy: "u1",
      lastMessage: "Conversa protegida criada",
      lastMessageAt: "Agora",
      unread: 0,
    }
    conversations.unshift(conversation)
    history[conversation.id] = []
    return conversation
  },
  async addMember(conversationId: string, userId: string): Promise<void> {
    await wait()
    const conversation = conversations.find(
      (item) => item.id === conversationId,
    )
    conversation?.participants.push({ userId, role: "member", online: true })
  },
  async removeMember(conversationId: string, userId: string): Promise<void> {
    await wait()
    const conversation = conversations.find(
      (item) => item.id === conversationId,
    )
    if (conversation)
      conversation.participants = conversation.participants.filter(
        (item) => item.userId !== userId,
      )
  },
  async leaveConversation(conversationId: string): Promise<void> {
    await wait()
    const index = conversations.findIndex((item) => item.id === conversationId)
    if (index >= 0) conversations.splice(index, 1)
  },
}
