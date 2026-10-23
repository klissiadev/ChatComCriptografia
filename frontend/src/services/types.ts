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

export type SendFailureCode =
  | "NOT_MEMBER"
  | "STALE_KEY" // refaça o resync das chaves e recife com a versão atual
  | "INVALID"
  | "INTERNAL"
  | "OFFLINE" // sem socket: reenviar ao reconectar, com o MESMO id
  | "TIMEOUT" // sem ACK: reenviar com o MESMO id (o servidor deduplica)

export type SendAck = {
  id: string
  status: "sent" | "delivered" | "failed"
  code?: SendFailureCode
  currentKeyVersion?: number
  seq?: number
  serverTimestamp?: string
}