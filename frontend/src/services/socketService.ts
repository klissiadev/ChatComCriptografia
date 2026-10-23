import { io, type Socket } from "socket.io-client"
import type {
  ClientToServerEvents,
  EncryptedMessage,
  ServerToClientEvents,
  StoredMessage,
} from "../../../shared/types"
import { getCryptoIntegration } from "./backend.ts"
import { API_URL } from "./http.ts"
import { clearSession, getSession } from "./session.ts"
import type { ConnectionState, Message, SendAck } from "./types"

type Callback<T> = (value: T) => void | Promise<void>
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const SEND_TIMEOUT_MS = 8000

let socket: AppSocket | null = null
let state: ConnectionState = "offline"
let failNext = false

const online = new Set<string>()
const processed = new Set<string>() // ids de mensagens já entregues à UI nesta sessão
let queue: Promise<void> = Promise.resolve()

const connectionCallbacks = new Set<Callback<ConnectionState>>()
const messageCallbacks = new Set<Callback<Message>>()
const statusCallbacks = new Set<Callback<{ messageId: string; userId: string; status: "delivered" }>>()
const presenceCallbacks = new Set<Callback<{ userId: string; online: boolean }>>()
const keyCallbacks = new Set<Callback<{ conversationId: string; keyVersion: number }>>()
const conversationUpdatedCallbacks = new Set<Callback<{ conversationId: string }>>()
const conversationRemovedCallbacks = new Set<Callback<{ conversationId: string }>>()
// Mantido só para compatibilidade com o DeveloperPanel; o servidor real não emite este evento.
const memberCallbacks = new Set<Callback<{ conversationId: string; userId: string; action: "added" | "removed" }>>()

function subscribe<T>(set: Set<Callback<T>>, callback: Callback<T>) {
  set.add(callback)
  return () => {
    set.delete(callback)
  }
}

/** Espera todos os handlers; se algum lançar erro, a promise rejeita (e o ACK não é enviado). */
async function notify<T>(set: Set<Callback<T>>, value: T): Promise<void> {
  await Promise.all([...set].map(async (callback) => callback(value)))
}

function fire<T>(set: Set<Callback<T>>, value: T): void {
  notify(set, value).catch((error) => console.error("Falha em handler do socket", error))
}

/** Processa chaves e mensagens em série: a chave sempre é importada antes da mensagem que a usa. */
function enqueue(job: () => Promise<void>): void {
  queue = queue.then(job).catch((error) => console.error("Falha ao processar evento", error))
}

function setState(next: ConnectionState): void {
  if (next === state) return
  state = next
  connectionCallbacks.forEach((callback) => void callback(next))
}

function toMessage(stored: StoredMessage): Message {
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
  }
}

function createSocket(token: string): AppSocket {
  const s: AppSocket = io(API_URL, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  })

  s.on("connect", () => setState("connected"))

  s.on("disconnect", (reason) => {
    if (reason === "io client disconnect") setState("offline")
    else {
      setState("reconnecting")
      if (reason === "io server disconnect") s.connect() // o servidor derrubou: não reconecta sozinho
    }
  })

  s.on("connect_error", (error) => {
    if (error.message === "UNAUTHORIZED") {
      clearSession()
      window.dispatchEvent(new Event("cifra:unauthorized"))
      socketService.destroy()
      return
    }
    setState("reconnecting")
  })

  s.io.on("reconnect_attempt", () => setState("reconnecting"))

  s.on("presence:snapshot", (ids) => {
    const previous = new Set(online)
    online.clear()
    for (const id of ids) {
      online.add(id)
      fire(presenceCallbacks, { userId: id, online: true })
    }
    for (const id of previous) if (!online.has(id)) fire(presenceCallbacks, { userId: id, online: false })
  })

  s.on("presence:update", ({ userId, online: isOnline }) => {
    if (isOnline) online.add(userId)
    else online.delete(userId)
    fire(presenceCallbacks, { userId, online: isOnline })
  })

  s.on("key:update", (update) =>
    enqueue(async () => {
      await getCryptoIntegration().receiveKey(update) // se falhar, sem ACK: o servidor reenvia na reconexão
      s.emit("key:ack", { conversationId: update.conversationId, keyVersion: update.keyVersion })
      await notify(keyCallbacks, { conversationId: update.conversationId, keyVersion: update.keyVersion })
    }),
  )

  s.on("message:new", (stored) =>
    enqueue(async () => {
      if (!processed.has(stored.id)) {
        await notify(messageCallbacks, toMessage(stored)) // handler async: se lançar, não confirma
        processed.add(stored.id)
      }
      s.emit("message:delivered", { messageId: stored.id })
    }),
  )

  s.on("message:status", (status) => fire(statusCallbacks, status))
  s.on("conversation:updated", (payload) => fire(conversationUpdatedCallbacks, payload))
  s.on("conversation:removed", (payload) => fire(conversationRemovedCallbacks, payload))

  return s
}

export const socketService = {
  async connect(): Promise<void> {
    const session = getSession()
    if (!session) throw new Error("Sem sessão ativa")
    if (!socket) {
      setState("reconnecting")
      socket = createSocket(session.token)
    } else if (!socket.connected && !socket.active) {
      setState("reconnecting")
      socket.connect()
    }
  },

  /** Desconexão manual (aparece como "offline"); connect() ou setConnection("connected") reabre. */
  disconnect(): void {
    if (socket) socket.disconnect()
    else setState("offline")
  },

  /** Logout: fecha o socket e limpa todo o estado em memória. */
  destroy(): void {
    socket?.removeAllListeners()
    socket?.disconnect()
    socket = null
    online.clear()
    processed.clear()
    queue = Promise.resolve()
    setState("offline")
  },

  /** Usado pelo DeveloperPanel: "offline" e "connected" agem de verdade sobre o socket. */
  setConnection(next: ConnectionState): void {
    if (next === "offline") this.disconnect()
    else if (next === "connected") void this.connect().catch(console.error)
    else setState(next)
  },

  getConnection(): ConnectionState {
    return state
  },

  isOnline(userId: string): boolean {
    return online.has(userId)
  },

  failNextSend(): void {
    failNext = true
  },

  onConnectionChange: (callback: Callback<ConnectionState>) => subscribe(connectionCallbacks, callback),
  /** O handler pode ser async: a mensagem só é confirmada ao servidor (message:delivered) quando ele resolver. */
  onMessage: (callback: Callback<Message>) => subscribe(messageCallbacks, callback),
  onMessageStatus: (callback: Callback<{ messageId: string; userId: string; status: "delivered" }>) =>
    subscribe(statusCallbacks, callback),
  onPresence: (callback: Callback<{ userId: string; online: boolean }>) => subscribe(presenceCallbacks, callback),
  /** Disparado depois que a chave foi decifrada, guardada e confirmada (key:ack). */
  onKeyUpdate: (callback: Callback<{ conversationId: string; keyVersion: number }>) => subscribe(keyCallbacks, callback),
  /** Membros/versão mudaram: refaça apiService.listConversations(). */
  onConversationUpdated: (callback: Callback<{ conversationId: string }>) =>
    subscribe(conversationUpdatedCallbacks, callback),
  onConversationRemoved: (callback: Callback<{ conversationId: string }>) =>
    subscribe(conversationRemovedCallbacks, callback),
  onMemberChange: (callback: Callback<{ conversationId: string; userId: string; action: "added" | "removed" }>) =>
    subscribe(memberCallbacks, callback),

  /** Envia só os campos de EncryptedMessage. Falhas voltam em ack.code; reenvie com o mesmo id. */
  sendMessage(message: Message): Promise<SendAck> {
    if (!socket || !socket.connected) {
      return Promise.resolve({ id: message.id, status: "failed", code: "OFFLINE" })
    }
    if (failNext) {
      failNext = false
      return Promise.resolve({ id: message.id, status: "failed", code: "OFFLINE" })
    }
    const payload: EncryptedMessage = {
      id: message.id,
      conversationId: message.conversationId,
      keyVersion: message.keyVersion,
      ciphertext: message.ciphertext,
      iv: message.iv,
      signature: message.signature,
    }
    return new Promise<SendAck>((resolve) => {
      socket!.timeout(SEND_TIMEOUT_MS).emit("message:send", payload, (error, ack) => {
        if (error) return resolve({ id: message.id, status: "failed", code: "TIMEOUT" })
        if (!ack.ok) {
          return resolve({ id: message.id, status: "failed", code: ack.code, currentKeyVersion: ack.currentKeyVersion })
        }
        resolve({
          id: message.id,
          status: ack.deliveredTo.length > 0 ? "delivered" : "sent",
          seq: ack.seq,
          serverTimestamp: ack.createdAt,
        })
      })
    })
  },

  // ---- ferramentas de desenvolvimento (só afetam a UI local, nunca o servidor) ----
  simulatePresence(userId: string, isOnline: boolean): void {
    fire(presenceCallbacks, { userId, online: isOnline })
  },
  simulateMemberRemoval(conversationId: string, userId: string): void {
    fire(memberCallbacks, { conversationId, userId, action: "removed" })
  },
}