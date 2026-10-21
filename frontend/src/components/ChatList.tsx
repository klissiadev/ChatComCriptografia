import { useMemo, useState } from "react"
import { useChat } from "../context/ChatContext"
import type { Conversation } from "../services/types"
import { Avatar, Button, IconButton, Input } from "./ui"
import { Icon } from "./Icon"

function ConversationItem({ conversation }: { conversation: Conversation }) {
  const { currentUser, selectedId, selectConversation } = useChat()
  const directContact = conversation.participants.find(
    (participant) => participant.userId !== currentUser.id,
  )
  const online = directContact?.online
  return (
    <button
      aria-current={selectedId === conversation.id ? "page" : undefined}
      className={`conversation-item ${
        selectedId === conversation.id ? "conversation-active" : ""
      }`}
      onClick={() => selectConversation(conversation.id)}
    >
      <div className="relative shrink-0">
        <Avatar name={conversation.name} />
        {conversation.type === "direct" && (
          <span
            className={`presence-dot ${
              online ? "presence-online" : "presence-offline"
            }`}
          />
        )}
        {conversation.type === "group" && (
          <span className="group-badge">
            <Icon name="group" size={11} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-primary">
            {conversation.name}
          </span>
          <span className="shrink-0 text-xs text-tertiary">
            {conversation.lastMessageAt}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <Icon className="shrink-0 text-tertiary" name="lock" size={11} />
          <span className="truncate text-xs text-secondary">
            {conversation.lastMessage}
          </span>
          {!!conversation.unread && (
            <span className="unread-badge">{conversation.unread}</span>
          )}
        </div>
      </div>
    </button>
  )
}

export function ChatList({
  onNewConversation,
  onMenu,
}: {
  onNewConversation: () => void
  onMenu: () => void
}) {
  const { conversations, currentUser } = useChat()
  const [query, setQuery] = useState("")
  const filtered = useMemo(
    () =>
      conversations.filter((conversation) =>
        conversation.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [conversations, query],
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-mark">
          <Icon name="shield" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold leading-none text-primary">
            Cifra
          </div>
          <div className="mt-1 text-xs text-tertiary">Mensagens protegidas</div>
        </div>
        <IconButton label="Abrir menu do usuário" onClick={onMenu}>
          <Icon name="more" />
        </IconButton>
      </div>
      <div className="px-4 pb-3">
        <label className="search-field">
          <Icon name="search" size={17} />
          <Input
            aria-label="Buscar conversas"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar conversas"
            value={query}
          />
        </label>
        <Button className="mt-3 w-full" onClick={onNewConversation}>
          <Icon name="plus" size={17} /> Nova conversa
        </Button>
      </div>
      <div className="list-label">Conversas</div>
      <div className="conversation-list">
        {filtered.length ? (
          filtered.map((conversation) => (
            <ConversationItem
              conversation={conversation}
              key={conversation.id}
            />
          ))
        ) : (
          <div className="empty-list">
            <div className="empty-icon">
              <Icon name="lock" />
            </div>
            <p className="font-semibold text-primary">
              Nenhuma conversa encontrada
            </p>
            <p className="mt-1 text-sm text-secondary">
              Inicie uma conversa segura com alguém.
            </p>
          </div>
        )}
      </div>
      <div className="sidebar-profile">
        <Avatar name={currentUser.username} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-primary">
            {currentUser.username}
          </div>
          <div className="flex items-center gap-1 text-xs text-success">
            <span className="status-dot" /> Protegido
          </div>
        </div>
      </div>
    </aside>
  )
}
