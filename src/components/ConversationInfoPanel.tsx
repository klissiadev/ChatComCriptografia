import { useEffect, useState } from "react"
import { useChat } from "../context/ChatContext"
import { cryptoService } from "../services/cryptoService"
import { Avatar, Button, IconButton } from "./ui"
import { Icon } from "./Icon"

export function ConversationInfoPanel({ onClose }: { onClose: () => void }) {
  const { conversations, currentUser, selectedId, users } = useChat()
  const [fingerprint, setFingerprint] = useState("Calculando...")
  const [showAddNotice, setShowAddNotice] = useState(false)
  const conversation = conversations.find((item) => item.id === selectedId)

  useEffect(() => {
    if (!conversation) return
    const key =
      conversation.type === "direct"
        ? users.find(
            (user) =>
              user.id ===
              conversation.participants.find(
                (participant) => participant.userId !== currentUser.id,
              )?.userId,
          )?.publicKey
        : `group_${conversation.id}_${conversation.keyVersion}`
    void cryptoService.getFingerprint(key ?? "").then(setFingerprint)
  }, [conversation, currentUser.id, users])

  if (!conversation) return null
  const canRemove =
    conversation.type === "group" && conversation.createdBy === currentUser.id
  return (
    <aside className="info-panel">
      <div className="info-header">
        <div>
          <h2 className="font-display text-base font-bold text-primary">
            Informações
          </h2>
          <p className="text-xs text-secondary">Detalhes e segurança</p>
        </div>
        <IconButton label="Fechar informações" onClick={onClose}>
          <Icon name="x" />
        </IconButton>
      </div>
      <div className="info-scroll">
        <div className="info-identity">
          <Avatar name={conversation.name} size="lg" />
          <h3 className="mt-3 font-display font-bold text-primary">
            {conversation.name}
          </h3>
          <span className="secure-pill">
            <Icon name="lock" size={12} /> Criptografia ativa
          </span>
        </div>
        <div className="info-section">
          <div className="section-title">
            Fingerprint{" "}
            {conversation.type === "direct" ? "do contato" : "da conversa"}
          </div>
          <div className="fingerprint-card">
            <Icon name="fingerprint" />
            <code>{fingerprint}</code>
          </div>
          <p className="help-text">
            Compare este código em outro canal para confirmar a identidade.
          </p>
        </div>
        <div className="info-section">
          <div className="section-title">
            {conversation.participants.length} membros
          </div>
          <div className="member-list">
            {conversation.participants.map((participant) => {
              const user = users.find((item) => item.id === participant.userId)
              if (!user) return null
              return (
                <div className="member" key={participant.userId}>
                  <div className="relative">
                    <Avatar name={user.username} size="sm" />
                    <span
                      className={`presence-dot ${
                        participant.online
                          ? "presence-online"
                          : "presence-offline"
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-primary">
                      {user.username}
                      {user.id === currentUser.id ? " (você)" : ""}
                    </div>
                    <div className="text-xs text-secondary">
                      {participant.role === "admin"
                        ? "Administrador"
                        : participant.online
                          ? "Online"
                          : "Recebe a nova chave ao reconectar"}
                    </div>
                  </div>
                  {canRemove && user.id !== currentUser.id && (
                    <IconButton label={`Remover ${user.username}`}>
                      <Icon className="text-danger" name="trash" size={16} />
                    </IconButton>
                  )}
                </div>
              )
            })}
          </div>
          <Button
            className="mt-3 w-full"
            onClick={() => setShowAddNotice(true)}
            variant="secondary"
          >
            <Icon name="user-plus" /> Adicionar membro
          </Button>
          {showAddNotice && (
            <div className="inline-notice">
              <Icon name="info" />
              <span>
                {conversation.type === "direct"
                  ? "Será criada uma nova conversa com todos. O histórico antigo continua na conversa original."
                  : "A nova chave será distribuída a todos os membros do grupo."}
              </span>
            </div>
          )}
        </div>
        {conversation.type === "group" && (
          <Button className="w-full" variant="danger">
            <Icon name="logout" /> Sair do grupo
          </Button>
        )}
      </div>
    </aside>
  )
}
