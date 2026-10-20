export type User = {
  id: string
  username: string
  publicKey: string
}

export type Participant = {
  userId: string
  role: "admin" | "member"
  online: boolean
}

export type Conversation = {
  id: string
  type: "direct" | "group"
  name: string
  participants: Participant[]
  keyVersion: number
  createdBy: string
  lastMessage?: string
  lastMessageAt?: string
  unread?: number
  keyPending?: boolean
}

export type MessageStatus = "sending" | "sent" | "delivered" | "failed" | "queued"

export type Message = {
  id: string
  conversationId: string
  senderId: string
  keyVersion: number
  iv: string
  ciphertext: string
  signature: string
  serverTimestamp: string
  seq: number
  status: MessageStatus
  system?: boolean
}

export type Verification = "ok" | "invalid_signature" | "tampered" | "waiting_key"

export type DecryptedMessage = Message & {
  text: string
  verification: Verification
}

export type ConnectionState = "connected" | "reconnecting" | "offline"

export type SendAck = {
  id: string
  status: "sent" | "delivered" | "failed"
}
