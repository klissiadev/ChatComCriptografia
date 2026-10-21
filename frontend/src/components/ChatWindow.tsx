import { useEffect, useRef, useState } from "react"
import { useChat } from "../context/ChatContext"
import { Icon } from "./Icon"
import { MessageBubble } from "./MessageBubble"
import { Button, IconButton } from "./ui"

export function ChatWindow({
  onBack,
  onInfo,
}: {
  onBack: () => void
  onInfo: () => void
}) {
  const {
    conversations,
    currentUser,
    selectedId,
    messages,
    sendMessage,
    loadingHistory,
    historyError,
    reloadHistory,
  } = useChat()
  const [draft, setDraft] = useState("")
  const endRef = useRef<HTMLDivElement>(null)
  const conversation = conversations.find((item) => item.id === selectedId)
  const directContact = conversation?.participants.find(
    (participant) => participant.userId !== currentUser.id,
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, selectedId])
  if (!conversation) {
    return (
      <main className="empty-chat">
        <div className="empty-chat-illustration">
          <Icon name="shield" size={36} />
        </div>
        <h2 className="font-display text-xl font-bold text-primary">
          Suas conversas são privadas
        </h2>
        <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-secondary">
          Selecione uma conversa. As mensagens são cifradas antes de sair deste
          dispositivo.
        </p>
      </main>
    )
  }
  const items = messages[conversation.id] ?? []
  const subtitle =
    conversation.type === "group"
      ? `${conversation.participants.length} membros`
      : directContact?.online
        ? "Online agora"
        : "Offline"

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.trim() || conversation?.keyPending) return
    const text = draft
    setDraft("")
    await sendMessage(text)
  }

  return (
    <main className="chat-window">
      <header className="chat-header">
        <IconButton
          className="md:hidden"
          label="Voltar para conversas"
          onClick={onBack}
        >
          <Icon name="arrow-left" />
        </IconButton>
        <div className="header-avatar">
          <span>{conversation.name.slice(0, 1)}</span>
          <Icon name="lock" size={10} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-bold text-primary">
            {conversation.name}
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-secondary">
            {conversation.type === "direct" && (
              <span
                className={`status-dot ${
                  directContact?.online ? "bg-success" : "bg-tertiary"
                }`}
              />
            )}
            {subtitle}
          </div>
        </div>
        <div className="encrypted-label">
          <Icon name="lock" size={13} /> Ponta a ponta
        </div>
        <IconButton label="Informações da conversa" onClick={onInfo}>
          <Icon name="info" />
        </IconButton>
      </header>
      <section aria-label="Mensagens" className="messages">
        {loadingHistory ? (
          <div className="history-state">
            <Icon className="animate-spin text-accent" name="spinner" />
            <span>Decifrando histórico...</span>
          </div>
        ) : historyError ? (
          <div className="history-state">
            <Icon className="text-danger" name="alert" />
            <span>{historyError}</span>
            <Button onClick={() => void reloadHistory()} variant="secondary">
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            <div className="date-separator">
              <span>Hoje</span>
            </div>
            <div className="encryption-notice">
              <Icon name="lock" size={13} /> As mensagens são protegidas com
              criptografia de ponta a ponta.
            </div>
            {items.map((message) => (
              <MessageBubble
                conversation={conversation}
                key={message.id}
                message={message}
              />
            ))}
            <div ref={endRef} />
          </>
        )}
      </section>
      {conversation.keyPending && (
        <div className="key-pending">
          <Icon className="animate-pulse" name="lock" />
          <div>
            <strong>Chave pendente</strong>
            <span>
              O campo será liberado quando o contato concluir a troca de chaves.
            </span>
          </div>
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <div className="composer-input">
          <input
            aria-label="Digite uma mensagem"
            disabled={conversation.keyPending}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              conversation.keyPending
                ? "Aguardando chave de segurança..."
                : "Digite uma mensagem segura"
            }
            value={draft}
          />
          <span className="composer-lock">
            <Icon name="lock" size={12} />
          </span>
        </div>
        <IconButton
          className="send-button"
          disabled={!draft.trim() || conversation.keyPending}
          label="Enviar mensagem"
          type="submit"
        >
          <Icon name="send" size={19} />
        </IconButton>
      </form>
    </main>
  )
}
