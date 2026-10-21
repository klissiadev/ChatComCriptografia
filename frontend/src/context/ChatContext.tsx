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
import { cryptoService, asDecrypted } from "../services/cryptoService"
import { socketService } from "../services/socketService"
import type {
  ConnectionState,
  Conversation,
  DecryptedMessage,
  Message,
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
  setConnection: (state: ConnectionState) => void
  simulateIncoming: () => void
  simulatePresence: () => void
  simulateRemoval: () => void
  simulateFailedSend: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({
  currentUser,
  children,
}: {
  currentUser: User
  children: React.ReactNode
}) {
  const [users, setUsers] = useState<User[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<Record<string, DecryptedMessage[]>>(
    {},
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connection, setConnectionState] =
    useState<ConnectionState>("connected")
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const queuedRef = useRef(new Map<string, DecryptedMessage>())

  useEffect(() => {
    let active = true

    Promise.all([apiService.listUsers(), apiService.listConversations()])
      .then(([allUsers, allConversations]) => {
        if (!active) return
        setUsers(allUsers)
        setConversations(allConversations)
        setSelectedId(allConversations[0]?.id ?? null)
      })
      .catch((error) => {
        console.error('Falha ao carregar dados iniciais', error)
        // aqui dá para setar um estado de erro e mostrar o botão "Tentar novamente"
      })

    const unsubscribe = socketService.onConnectionChange(setConnectionState)

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const reloadHistory = useCallback(async () => {
    if (!selectedId) return
    setLoadingHistory(true)
    setHistoryError(null)
    try {
      const result = await apiService.getHistory(selectedId)
      setMessages((current) => ({ ...current, [selectedId]: result }))
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as mensagens",
      )
    } finally {
      setLoadingHistory(false)
    }
  }, [selectedId])

  useEffect(() => {
    if (selectedId && !messages[selectedId]) void reloadHistory()
  }, [messages, reloadHistory, selectedId])

  const updateStatus = useCallback(
    (
      conversationId: string,
      id: string,
      status: DecryptedMessage["status"],
    ) => {
      setMessages((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? []).map((message) =>
          message.id === id ? { ...message, status } : message,
        ),
      }))
    },
    [],
  )

  const deliver = useCallback(
    async (message: DecryptedMessage) => {
      const ack = await socketService.sendMessage(message)
      if (ack.status === "failed") {
        updateStatus(message.conversationId, message.id, "failed")
        return
      }
      queuedRef.current.delete(message.id)
      updateStatus(message.conversationId, message.id, ack.status)
    },
    [updateStatus],
  )

  useEffect(() => {
    if (connection !== "connected") return
    queuedRef.current.forEach((message) => {
      updateStatus(message.conversationId, message.id, "sending")
      void deliver(message)
    })
  }, [connection, deliver, updateStatus])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!selectedId || !text.trim()) return
      const id = crypto.randomUUID()
      const skeleton: DecryptedMessage = {
        id,
        conversationId: selectedId,
        senderId: currentUser.id,
        keyVersion: 1,
        iv: "",
        ciphertext: "",
        signature: "",
        serverTimestamp: new Date().toISOString(),
        seq: Date.now(),
        status: connection === "connected" ? "sending" : "queued",
        text: text.trim(),
        verification: "ok",
      }
      setMessages((current) => ({
        ...current,
        [selectedId]: [...(current[selectedId] ?? []), skeleton],
      }))
      const encrypted = await cryptoService.encryptMessage(
        text.trim(),
        selectedId,
      )
      const ready = { ...skeleton, ...encrypted }
      setMessages((current) => ({
        ...current,
        [selectedId]: (current[selectedId] ?? []).map((message) =>
          message.id === id ? ready : message,
        ),
      }))
      if (connection !== "connected") {
        queuedRef.current.set(id, ready)
        return
      }
      await deliver(ready)
    },
    [connection, currentUser.id, deliver, selectedId],
  )

  const retryMessage = useCallback(
    async (id: string) => {
      if (!selectedId) return
      const message = messages[selectedId]?.find((item) => item.id === id)
      if (!message) return
      updateStatus(
        selectedId,
        id,
        connection === "connected" ? "sending" : "queued",
      )
      if (connection !== "connected") {
        queuedRef.current.set(id, message)
        return
      }
      await deliver(message)
    },
    [connection, deliver, messages, selectedId, updateStatus],
  )

  const createConversation = useCallback(
    async (ids: string[], name?: string) => {
      const conversation = await apiService.createConversation(ids, name)
      setConversations((current) => [conversation, ...current])
      setMessages((current) => ({ ...current, [conversation.id]: [] }))
      setSelectedId(conversation.id)
      return conversation
    },
    [],
  )

  const setConnection = useCallback(
    (state: ConnectionState) => socketService.setConnection(state),
    [],
  )

  const simulateIncoming = useCallback(() => {
    if (!selectedId) return
    const conversation = conversations.find((item) => item.id === selectedId)
    const senderId =
      conversation?.participants.find(
        (participant) => participant.userId !== currentUser.id,
      )?.userId ?? "u2"
    const message: Message = {
      id: crypto.randomUUID(),
      conversationId: selectedId,
      senderId,
      keyVersion: 1,
      iv: "mock",
      ciphertext: btoa("Recebi. Está tudo protegido por aqui."),
      signature: "mock",
      serverTimestamp: new Date().toISOString(),
      seq: Date.now(),
      status: "delivered",
    }
    setMessages((current) => ({
      ...current,
      [selectedId]: [
        ...(current[selectedId] ?? []),
        asDecrypted(message, "Recebi. Está tudo protegido por aqui."),
      ],
    }))
  }, [conversations, currentUser.id, selectedId])

  const simulatePresence = useCallback(() => {
    if (!selectedId) return
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selectedId
          ? {
              ...conversation,
              participants: conversation.participants.map((participant) =>
                participant.userId === currentUser.id
                  ? participant
                  : { ...participant, online: !participant.online },
              ),
            }
          : conversation,
      ),
    )
  }, [currentUser.id, selectedId])

  const simulateRemoval = useCallback(() => {
    if (!selectedId) return
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selectedId && conversation.type === "group"
          ? {
              ...conversation,
              keyVersion: conversation.keyVersion + 1,
              participants: conversation.participants.slice(0, -1),
            }
          : conversation,
      ),
    )
    const systemMessage: DecryptedMessage = {
      id: crypto.randomUUID(),
      conversationId: selectedId,
      senderId: "system",
      keyVersion: 1,
      iv: "",
      ciphertext: "",
      signature: "",
      serverTimestamp: new Date().toISOString(),
      seq: Date.now(),
      status: "delivered",
      text: "Um membro foi removido. A chave de segurança do grupo foi atualizada",
      verification: "ok",
      system: true,
    }
    setMessages((current) => ({
      ...current,
      [selectedId]: [...(current[selectedId] ?? []), systemMessage],
    }))
  }, [selectedId])

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
      selectConversation: setSelectedId,
      sendMessage,
      retryMessage,
      reloadHistory,
      createConversation,
      setConnection,
      simulateIncoming,
      simulatePresence,
      simulateRemoval,
      simulateFailedSend,
    }),
    [
      connection,
      conversations,
      createConversation,
      currentUser,
      historyError,
      loadingHistory,
      messages,
      reloadHistory,
      retryMessage,
      selectedId,
      sendMessage,
      setConnection,
      simulateFailedSend,
      simulateIncoming,
      simulatePresence,
      simulateRemoval,
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
