import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { apiService } from "../services/apiService"
import { cryptoService } from "../services/cryptoService"
import { socketService } from "../services/socketService"
import type {
  ConnectionState,
  Conversation,
  DecryptedMessage,
  User,
} from "../services/types"

type ChatContextValue = {
  currentUser: User
  users: User[]
  conversations: Conversation[]
  messages: Record<string, DecryptedMessage[]>
  selectedId: string | null
  connection: ConnectionState
  loadingHistory: boolean
  historyError: string | null
  selectConversation: (id: string | null) => void
  sendMessage: (text: string) => Promise<void>
  retryMessage: (id: string) => Promise<void>
  reloadHistory: () => Promise<void>
  createConversation: (ids: string[], name?: string) => Promise<Conversation>
  /** Em conversa direta cria uma NOVA conversa com todos e a seleciona. */
  addMember: (conversationId: string, userId: string) => Promise<Conversation>
  removeMember: (conversationId: string, userId: string) => Promise<void>
  leaveConversation: (conversationId: string) => Promise<void>
  refreshConversations: () => Promise<Conversation[]>
  refreshUsers: () => Promise<void>
  setConnection: (state: ConnectionState) => void
  simulateFailedSend: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

const byOrder = (a: DecryptedMessage, b: DecryptedMessage) => a.seq - b.seq

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

function preview(message: DecryptedMessage): string {
  if (message.verification === "ok") return message.text
  if (message.verification === "waiting_key") return "Aguardando chave de segurança"
  return "Mensagem não verificada"
}

function keyChangedMessage(conversationId: string, keyVersion: number): DecryptedMessage {
  return {
    id: `system:${conversationId}:${keyVersion}`,
    conversationId,
    senderId: "system",
    keyVersion,
    iv: "",
    ciphertext: "",
    signature: "",
    serverTimestamp: new Date().toISOString(),
    seq: Date.now(),
    status: "delivered",
    text: "A chave de segurança do grupo foi atualizada",
    verification: "ok",
    system: true,
  }
}

export function ChatProvider({
  currentUser,
  children,
}: {
  currentUser: User
  children: React.ReactNode
}) {
  const [users, setUsers] = useState<User[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<Record<string, DecryptedMessage[]>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connection, setConnectionState] = useState<ConnectionState>(
    socketService.getConnection(),
  )
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const queuedRef = useRef(new Map<string, DecryptedMessage>())
  const loadedRef = useRef(new Set<string>()) // conversas cujo histórico já foi carregado
  const conversationsRef = useRef<Conversation[]>([])
  const usersRef = useRef<User[]>([])
  const messagesRef = useRef<Record<string, DecryptedMessage[]>>({})
  const selectedRef = useRef<string | null>(null)
  useEffect(() => {
    usersRef.current = users
    conversationsRef.current = conversations
    messagesRef.current = messages
    selectedRef.current = selectedId
  }, [conversations, messages, selectedId, users])

  // ---------- helpers de estado ----------

  const upsertMessage = useCallback((message: DecryptedMessage) => {
    setMessages((current) => {
      const list = current[message.conversationId] ?? []
      const index = list.findIndex((item) => item.id === message.id)
      const next =
        index >= 0 ? list.map((item, i) => (i === index ? message : item)) : [...list, message]
      return { ...current, [message.conversationId]: next.sort(byOrder) }
    })
  }, [])

  const patchMessage = useCallback(
    (conversationId: string, id: string, changes: Partial<DecryptedMessage>) => {
      setMessages((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? [])
          .map((message) => (message.id === id ? { ...message, ...changes } : message))
          .sort(byOrder),
      }))
    },
    [],
  )
  const touchConversation = useCallback((message: DecryptedMessage, incoming: boolean) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === message.conversationId
          ? {
              ...conversation,
              lastMessage: preview(message),
              lastMessageAt: clock(message.serverTimestamp),
              unread:
                incoming && selectedRef.current !== conversation.id
                  ? (conversation.unread ?? 0) + 1
                  : conversation.unread,
            }
          : conversation,
      ),
    )
  }, [])

  const dropConversation = useCallback((conversationId: string) => {
    loadedRef.current.delete(conversationId)
    setConversations((current) => current.filter((item) => item.id !== conversationId))
    setMessages((current) => {
      const next = { ...current }
      delete next[conversationId]
      return next
    })
    setSelectedId((current) => (current === conversationId ? null : current))
  }, [])

  /** Recarrega do servidor mantendo o que só existe no cliente (prévia e não lidas). */

  const refreshUsers = useCallback(async () => {
    try {
      setUsers(await apiService.listUsers())
    } catch (error) {
      console.error("Falha ao atualizar usuários", error)
    }
  }, [])
  const hasUnknown = (ids: string[]) =>
    ids.some((id) => !usersRef.current.some((user) => user.id === id))
  const refreshConversations = useCallback(async () => {
    const fresh = await apiService.listConversations()
    if (hasUnknown(fresh.flatMap((c) => c.participants.map((p) => p.userId)))) {
     void refreshUsers()
    }
    const previous = conversationsRef.current
    setConversations(
      fresh.map((conversation) => {
        const old = previous.find((item) => item.id === conversation.id)
        return old
          ? {
              ...conversation,
              lastMessage: old.lastMessage,
              lastMessageAt: old.lastMessageAt,
              unread: old.unread,
            }
          : conversation
      }),
    )
    const rotated = fresh.filter(
      (conversation) =>
        conversation.type === "group" &&
        previous.some((old) => old.id === conversation.id && conversation.keyVersion > old.keyVersion),
    )
    if (rotated.length) {
      setMessages((current) => {
        const next = { ...current }
        for (const conversation of rotated) {
          if (!loadedRef.current.has(conversation.id)) continue
          const system = keyChangedMessage(conversation.id, conversation.keyVersion)
          const list = next[conversation.id] ?? []
          if (!list.some((item) => item.id === system.id)) next[conversation.id] = [...list, system]
        }
        return next
      })
    }
    setSelectedId((current) => (current && !fresh.some((item) => item.id === current) ? null : current))
    return fresh
  }, [refreshUsers])
  // ---------- carga inicial, socket e eventos ----------
  
  useEffect(() => {
    let active = true
    void socketService.connect().catch((error) => console.error("Falha ao conectar o socket", error))
    Promise.all([apiService.listUsers(), apiService.listConversations()])
      .then(([allUsers, allConversations]) => {
        if (!active) return
        setUsers(allUsers)
        setConversations(allConversations)
        setSelectedId((current) => current ?? allConversations[0]?.id ?? null)
      })
      .catch((error) => console.error("Falha ao carregar dados iniciais", error))
    const unsubscribers = [
      socketService.onConnectionChange(setConnectionState),
      // Handler async: se lançar erro (ex.: rede), a mensagem NÃO é confirmada e o servidor reenvia.
      socketService.onMessage(async (message) => {
        const decrypted = await apiService.decryptMessage(message)
        if (hasUnknown([message.senderId])) void refreshUsers()
        upsertMessage(decrypted)
        touchConversation(decrypted, true)
      }),
      socketService.onMessageStatus(({ messageId, status }) => {
        setMessages((current) => {
          const next: typeof current = {}
          for (const [conversationId, list] of Object.entries(current)) {
            next[conversationId] = list.map((item) =>
              item.id === messageId ? { ...item, status } : item,
            )
          }
          return next
        })
      }),
      // Chave nova importada e confirmada: destrava mensagens em waiting_key e atualiza keyPending.
      socketService.onKeyUpdate(async ({ conversationId }) => {
        void refreshConversations().catch(console.error)
        const waiting = (messagesRef.current[conversationId] ?? []).filter(
          (item) => item.verification === "waiting_key",
        )
        for (const item of waiting) {
          try {
            upsertMessage(await apiService.decryptMessage(item))
          } catch (error) {
            console.error("Falha ao decifrar após chegada da chave", error)
          }
        }
      }),
      socketService.onConversationUpdated(() => {
        void refreshConversations().catch(console.error)
      }),
      socketService.onConversationRemoved(({ conversationId }) => dropConversation(conversationId)),
      socketService.onPresence(({ userId, online }) => {
        if (hasUnknown([userId])) void refreshUsers()
        setConversations((current) =>
          current.map((conversation) => ({
            ...conversation,
            participants: conversation.participants.map((participant) =>
              participant.userId === userId ? { ...participant, online } : participant,
            ),
          })),
        )
      }),
    ]

    return () => {
      active = false
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [dropConversation, refreshConversations, refreshUsers, touchConversation, upsertMessage])

  // ---------- histórico ----------

  const reloadHistory = useCallback(async () => {
    if (!selectedId) return
    setLoadingHistory(true)
    setHistoryError(null)
    try {
      const result = await apiService.getHistory(selectedId)
      loadedRef.current.add(selectedId)
      setMessages((current) => {
        // união por id: o servidor prevalece, mas mantém mensagens locais (enviando, fila, sistema)
        const merged = new Map<string, DecryptedMessage>()
        for (const item of current[selectedId] ?? []) merged.set(item.id, item)
        for (const item of result) merged.set(item.id, item)
        return { ...current, [selectedId]: [...merged.values()].sort(byOrder) }
      })
      const last = [...result].reverse().find((item) => !item.system)
      if (last) touchConversation(last, false)
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "Não foi possível carregar as mensagens",
      )
    } finally {
      setLoadingHistory(false)
    }
  }, [selectedId, touchConversation])

  useEffect(() => {
    if (selectedId && !loadedRef.current.has(selectedId)) void reloadHistory()
  }, [reloadHistory, selectedId])

  // ---------- envio ----------

  /* Envia; trata STALE_KEY (recifra com a versão atual) e fila offline. Sempre reutiliza o mesmo id. */

  const deliver = useCallback(
    async (initial: DecryptedMessage) => {
      let message = initial
      for (let attempt = 0; attempt < 3; attempt++) {
        const ack = await socketService.sendMessage(message)
        if (ack.status !== "failed") {
          queuedRef.current.delete(message.id)
          patchMessage(message.conversationId, message.id, {
            status: ack.status,
            seq: ack.seq ?? message.seq,
            serverTimestamp: ack.serverTimestamp ?? message.serverTimestamp,
          })
          return
        }
        if (ack.code === "STALE_KEY") {
          try {
            const fresh = await apiService.resyncKeys(message.conversationId)
            setConversations((current) =>
              current.map((item) =>
                item.id === fresh.id
                  ? { ...fresh, lastMessage: item.lastMessage, lastMessageAt: item.lastMessageAt, unread: item.unread }
                  : item,
              ),
            )
            if (fresh.keyPending) break
            const sealed = await cryptoService.encryptMessage(
              message.text,
              message.conversationId,
              fresh.keyVersion,
              currentUser.id,
              message.id,
            )
            message = { ...message, ...sealed }
            patchMessage(message.conversationId, message.id, sealed)
            continue
          } catch (error) {
            console.error("Falha ao recifrar após STALE_KEY", error)
            break
          }
        }
        if (
          (ack.code === "OFFLINE" || ack.code === "TIMEOUT") &&
          socketService.getConnection() !== "connected"
        ) {
          queuedRef.current.set(message.id, message)
          patchMessage(message.conversationId, message.id, { status: "queued" })
          return
        }
        break
      }
      queuedRef.current.delete(message.id)
      patchMessage(message.conversationId, message.id, { status: "failed" })
    },
    [currentUser.id, patchMessage],
  )

  // Ao reconectar: reenvia a fila (mesmos ids) e atualiza conversas/presença.
  useEffect(() => {
    if (connection !== "connected") return
    queuedRef.current.forEach((message) => {
      patchMessage(message.conversationId, message.id, { status: "sending" })
      void deliver(message)
    })
    void refreshConversations().catch(console.error)
    void refreshUsers()
  }, [connection, deliver, patchMessage, refreshConversations, refreshUsers])
  
  const sendMessage = useCallback(
    async (text: string) => {
      const clean = text.trim()
      const conversation = conversationsRef.current.find((item) => item.id === selectedId)
      
      if (!selectedId || !conversation || !clean || conversation.keyPending) return
      const id = crypto.randomUUID()
      const skeleton: DecryptedMessage = {
        id,
        conversationId: selectedId,
        senderId: currentUser.id,
        keyVersion: conversation.keyVersion,
        iv: "",
        ciphertext: "",
        signature: "",
        serverTimestamp: new Date().toISOString(),
        seq: Date.now(),
        status: socketService.getConnection() === "connected" ? "sending" : "queued",
        text: clean,
        verification: "ok",
      }
      upsertMessage(skeleton)
      touchConversation(skeleton, false)
      let ready: DecryptedMessage
      try {
        const sealed = await cryptoService.encryptMessage(
          clean,
          selectedId,
          conversation.keyVersion,
          currentUser.id,
          id,
        )
        ready = { ...skeleton, ...sealed }
      } catch (error) {
        console.error("Falha ao cifrar", error)
        patchMessage(selectedId, id, { status: "failed" })
        return
      }
      patchMessage(selectedId, id, ready)
      if (socketService.getConnection() !== "connected") {
        queuedRef.current.set(id, ready)
        return
      }
      await deliver(ready)
    },
    [currentUser.id, deliver, patchMessage, selectedId, touchConversation, upsertMessage],
  )

  const retryMessage = useCallback(
    async (id: string) => {
      if (!selectedId) return
      const conversation = conversationsRef.current.find((item) => item.id === selectedId)
      let message = messagesRef.current[selectedId]?.find((item) => item.id === id)
      if (!message || !conversation) return

      if (!message.ciphertext) {
        // falhou antes de cifrar: cifra agora com a versão atual da conversa
        try {
          const sealed = await cryptoService.encryptMessage(
            message.text,
            selectedId,
            conversation.keyVersion,
            currentUser.id,
            id,
          )
          message = { ...message, ...sealed }
        } catch (error) {
          console.error("Falha ao cifrar", error)
          return
        }
      }
      const connected = socketService.getConnection() === "connected"
      patchMessage(selectedId, id, { ...message, status: connected ? "sending" : "queued" })
      if (!connected) {
        queuedRef.current.set(id, message)
        return
      }
      await deliver(message)
    },
    [currentUser.id, deliver, patchMessage, selectedId],
  )

  // ---------- conversas e membros ----------

  const selectConversation = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) {
      setConversations((current) =>
        current.map((item) => (item.id === id ? { ...item, unread: 0 } : item)),
      )
    }
  }, [])

  const createConversation = useCallback(async (ids: string[], name?: string) => {
    const conversation = await apiService.createConversation(ids, name)
    loadedRef.current.add(conversation.id)
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)])
    setMessages((current) => ({ ...current, [conversation.id]: current[conversation.id] ?? [] }))
    setSelectedId(conversation.id)
    return conversation
  }, [])

  const addMember = useCallback(
    async (conversationId: string, userId: string) => {
      const result = await apiService.addMember(conversationId, userId)
      if (result.id !== conversationId) loadedRef.current.add(result.id) // conversa nova criada a partir de uma direta
      await refreshConversations()
      if (result.id !== conversationId) setSelectedId(result.id)
      return result
    },
    [refreshConversations],
  )
  const removeMember = useCallback(
    async (conversationId: string, userId: string) => {
      await apiService.removeMember(conversationId, userId)
      await refreshConversations()
    },
    [refreshConversations],
  )
  const leaveConversation = useCallback(
    async (conversationId: string) => {
      await apiService.leaveConversation(conversationId)
      dropConversation(conversationId)
    },
    [dropConversation],
  )
  const setConnection = useCallback(
    (state: ConnectionState) => socketService.setConnection(state),
    [],
  )
  const simulateFailedSend = useCallback(() => socketService.failNextSend(), [])
  const value = useMemo(
    () => ({
      currentUser,
      users,
      conversations,
      messages,
      selectedId,
      connection,
      loadingHistory,
      historyError,
      selectConversation,
      sendMessage,
      retryMessage,
      reloadHistory,
      createConversation,
      addMember,
      removeMember,
      leaveConversation,
      refreshConversations,
      refreshUsers,
        setConnection,
      simulateFailedSend,
    }),
    [
      addMember,
      connection,
      conversations,
      createConversation,
      currentUser,
      historyError,
      leaveConversation,
      loadingHistory,
      messages,
      refreshConversations,
      refreshUsers,
        reloadHistory,
      removeMember,
      retryMessage,
      selectConversation,
      selectedId,
      sendMessage,
      setConnection,
      simulateFailedSend,
      users,
    ],
  )
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
export function useChat() {
  const context = useContext(ChatContext)
  if (!context) throw new Error("useChat deve ser usado dentro de ChatProvider")
  return context
}