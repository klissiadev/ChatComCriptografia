import { useEffect, useState } from "react"
import { useChat } from "../context/ChatContext"
import { cryptoService } from "../services/cryptoService"
import { Avatar, Button, IconButton } from "./ui"
import { Icon } from "./Icon"

export function ConversationInfoPanel({
  onClose,
}: {
  onClose: () => void
}) {
  const {
    conversations,
    currentUser,
    selectedId,
    users,
    addMember,
    removeMember,
    leaveConversation,
    refreshConversations,
    refreshUsers,
    selectConversation,
  } = useChat()

  const [fingerprint, setFingerprint] = useState("Calculando...")
  const [showAddNotice, setShowAddNotice] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const conversation = conversations.find(
    (item) => item.id === selectedId,
  )

  useEffect(() => {
    if (!conversation) return

    const key =
      conversation.type === "direct"
        ? users.find(
            (user) =>
              user.id ===
              conversation.participants.find(
                (participant) =>
                  participant.userId !== currentUser.id,
              )?.userId,
          )?.publicKey
        : `group_${conversation.id}_${conversation.keyVersion}`

    void cryptoService
      .getFingerprint(key ?? "")
      .then(setFingerprint)
      .catch(() => setFingerprint("Indisponível"))
  }, [conversation, currentUser.id, users])

  useEffect(() => {
    if (showAddNotice) void refreshUsers()
  }, [showAddNotice, refreshUsers])

  if (!conversation) return null

  const canRemove =
    conversation.type === "group" &&
    conversation.createdBy === currentUser.id

  const participantIds = new Set(
    conversation.participants.map((participant) => participant.userId),
  )

  const availableUsers = users.filter(
    (user) =>
      user.id !== currentUser.id &&
      !participantIds.has(user.id),
  )

  async function handleAddMember() {
    if (!conversation || !selectedUserId || busy) return

    setBusy(true)
    setError(null)

    try {
      const result = await addMember(
        conversation.id,
        selectedUserId,
      )

      setSelectedUserId("")
      setShowAddNotice(false)

      if (result.id !== conversation.id) {
        selectConversation(result.id)
      }

      await refreshConversations()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível adicionar o membro.",
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!conversation || busy) return

    const user = users.find((item) => item.id === userId)
    const confirmed = window.confirm(
      `Deseja remover ${user?.username ?? "este membro"} da conversa?`,
    )

    if (!confirmed) return

    setBusy(true)
    setError(null)

    try {
      await removeMember(conversation.id, userId)
      await refreshConversations()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível remover o membro.",
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleLeaveConversation() {
    if (!conversation || busy) return

    const confirmed = window.confirm(
      `Deseja realmente sair do grupo "${conversation.name}"?`,
    )

    if (!confirmed) return

    setBusy(true)
    setError(null)

    try {
      await leaveConversation(conversation.id)
      onClose()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível sair do grupo.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="info-panel">
      <div className="info-header">
        <div>
          <h2 className="font-display text-base font-bold text-primary">
            Informações
          </h2>
          <p className="text-xs text-secondary">
            Detalhes e segurança
          </p>
        </div>

        <IconButton
          label="Fechar informações"
          onClick={onClose}
        >
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
            {conversation.type === "direct"
              ? "do contato"
              : "da conversa"}
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
              const user = users.find(
                (item) => item.id === participant.userId,
              )

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
                    <IconButton
                      label={`Remover ${user.username}`}
                      onClick={() =>
                        void handleRemoveMember(user.id)
                      }
                      disabled={busy}
                    >
                      <Icon
                        className="text-danger"
                        name="trash"
                        size={16}
                      />
                    </IconButton>
                  )}
                </div>
              )
            })}
          </div>

          <Button
            className="mt-3 w-full"
            onClick={() => {
              setError(null)
              setShowAddNotice((current) => !current)
            }}
            variant="secondary"
            disabled={busy}
          >
            <Icon name="user-plus" /> Adicionar membro
          </Button>

          {showAddNotice && (
            <div className="mt-3">
              <label
                htmlFor="new-member"
                className="mb-2 block text-sm text-secondary"
              >
                Selecione um usuário
              </label>

              {availableUsers.length > 0 ? (
                <>
                  <select
                    id="new-member"
                    className="w-full rounded-lg border p-2"
                    value={selectedUserId}
                    onChange={(event) =>
                      setSelectedUserId(event.target.value)
                    }
                    disabled={busy}
                  >
                    <option value="">Escolha um usuário</option>

                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username}
                      </option>
                    ))}
                  </select>

                  <Button
                    className="mt-2 w-full"
                    onClick={() => void handleAddMember()}
                    disabled={!selectedUserId || busy}
                  >
                    {busy ? "Adicionando..." : "Confirmar adição"}
                  </Button>
                </>
              ) : (
                <p className="help-text">
                  Não há usuários disponíveis para adicionar.
                </p>
              )}

              <p className="help-text mt-2">
                {conversation.type === "direct"
                  ? "Será criada uma nova conversa com todos. O histórico antigo permanece na conversa original."
                  : "A chave de segurança será atualizada para os membros da conversa."}
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>

        {conversation.type === "group" && (
          <Button
            className="w-full"
            variant="danger"
            onClick={() => void handleLeaveConversation()}
            disabled={busy}
          >
            <Icon name="logout" /> Sair do grupo
          </Button>
        )}
      </div>
    </aside>
  )
}