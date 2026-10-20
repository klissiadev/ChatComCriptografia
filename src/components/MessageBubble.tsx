import { useChat } from "../context/ChatContext"
import type {
  Conversation,
  DecryptedMessage,
  MessageStatus,
} from "../services/types"
import { Icon } from "./Icon"
import { SecurityBadge } from "./SecurityBadge"

const senderColors = [
  "text-sender-a",
  "text-sender-b",
  "text-sender-c",
  "text-sender-d",
]

function MessageStatusView({
  status,
  onRetry,
}: {
  status: MessageStatus
  onRetry: () => void
}) {
  if (status === "sending")
    return (
      <span className="message-status">
        <Icon name="clock" size={13} /> Enviando
      </span>
    )
  if (status === "sent")
    return (
      <span className="message-status">
        <Icon name="check" size={14} /> Enviada
      </span>
    )
  if (status === "delivered")
    return (
      <span className="message-status">
        <Icon name="checks" size={15} /> Entregue
      </span>
    )
  if (status === "queued") {
    return (
      <span className="message-status">
        <Icon name="cloud-off" size={14} /> Será enviada ao reconectar
      </span>
    )
  }
  return (
    <button
      className="message-status text-danger font-semibold"
      onClick={onRetry}
    >
      <Icon name="alert" size={14} /> Falhou · Tentar novamente
    </button>
  )
}

export function MessageBubble({
  message,
  conversation,
}: {
  message: DecryptedMessage
  conversation: Conversation
}) {
  const { currentUser, users, retryMessage } = useChat()
  const mine = message.senderId === currentUser.id
  const sender = users.find((user) => user.id === message.senderId)
  const senderColor =
    senderColors[
      Math.max(
        0,
        users.findIndex((user) => user.id === message.senderId),
      ) % senderColors.length
    ]
  const time = new Date(message.serverTimestamp).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (message.system) {
    return (
      <div className="system-message">
        <Icon name="lock" size={12} />
        {message.text}
      </div>
    )
  }

  const concealed =
    message.verification === "tampered" ||
    message.verification === "waiting_key"
  return (
    <div className={`message-row ${mine ? "message-row-mine" : ""}`}>
      <div
        className={`message-bubble ${mine ? "message-mine" : "message-other"} ${
          message.verification !== "ok" ? "message-unverified" : ""
        }`}
      >
        {conversation.type === "group" && !mine && (
          <div className={`message-sender ${senderColor}`}>
            {sender?.username ?? "Participante"}
          </div>
        )}
        {!concealed && <p className="message-text">{message.text}</p>}
        <div className="message-meta">
          <SecurityBadge verification={message.verification} />
          <span>{time}</span>
        </div>
        {message.verification !== "ok" && (
          <SecurityBadge verification={message.verification} />
        )}
      </div>
      {mine && (
        <MessageStatusView
          onRetry={() => void retryMessage(message.id)}
          status={message.status}
        />
      )}
    </div>
  )
}
