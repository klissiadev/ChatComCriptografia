import type { ConnectionState, Message, SendAck } from "./types"

type Callback<T> = (value: T) => void
let state: ConnectionState = "connected"
let failNext = false
const connectionCallbacks = new Set<Callback<ConnectionState>>()
const messageCallbacks = new Set<Callback<Message>>()
const presenceCallbacks = new Set<Callback<{
  userId: string
  online: boolean
}>>()
const keyCallbacks = new Set<Callback<{
  conversationId: string
  keyVersion: number
}>>()
const memberCallbacks = new Set<Callback<{
  conversationId: string
  userId: string
  action: "added" | "removed"
}>>()

const wait = () =>
  new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 600))

export const socketService = {
  async connect() {
    state = ("connected" as ConnectionState)
    connectionCallbacks.forEach((callback) => callback(state))
  },
  disconnect() {
    state = ("offline" as ConnectionState)
    connectionCallbacks.forEach((callback) => callback(state))
  },
  setConnection(next: ConnectionState) {
    state = next
    connectionCallbacks.forEach((callback) => callback(next))
  },
  getConnection() {
    return state
  },
  failNextSend() {
    failNext = true
  },
  onConnectionChange(callback: Callback<ConnectionState>) {
    connectionCallbacks.add(callback)
    return () => connectionCallbacks.delete(callback)
  },
  async sendMessage(message: Message): Promise<SendAck> {
    await wait()
    if (state !== "connected" || failNext) {
      failNext = false
      return { id: message.id, status: "failed" }
    }
    return {
      id: message.id,
      status: Math.random() > 0.25 ? "delivered" : "sent",
    }
  },
  onMessage(callback: Callback<Message>) {
    messageCallbacks.add(callback)
    return () => messageCallbacks.delete(callback)
  },
  onPresence(callback: Callback<{ userId: string online: boolean }>) {
    presenceCallbacks.add(callback)
    return () => presenceCallbacks.delete(callback)
  },
  onKeyUpdate(
    callback: Callback<{ conversationId: string keyVersion: number }>,
  ) {
    keyCallbacks.add(callback)
    return () => keyCallbacks.delete(callback)
  },
  onMemberChange(
    callback: Callback<{
      conversationId: string
      userId: string
      action: "added" | "removed"
    }>,
  ) {
    memberCallbacks.add(callback)
    return () => memberCallbacks.delete(callback)
  },
  simulatePresence(userId: string, online: boolean) {
    presenceCallbacks.forEach((callback) => callback({ userId, online }))
  },
  simulateMemberRemoval(conversationId: string, userId: string) {
    memberCallbacks.forEach((callback) =>
      callback({ conversationId, userId, action: "removed" }),
    )
    keyCallbacks.forEach((callback) =>
      callback({ conversationId, keyVersion: Date.now() }),
    )
  },
}
