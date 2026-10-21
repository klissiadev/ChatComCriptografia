import { useMemo, useState } from "react"
import { useChat } from "../context/ChatContext"
import { Icon } from "./Icon"
import { Modal } from "./Modal"
import { Avatar, Button, Input } from "./ui"

export function NewConversationModal({ onClose }: { onClose: () => void }) {
  const { currentUser, users, createConversation } = useChat()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [groupName, setGroupName] = useState("")
  const [loading, setLoading] = useState(false)
  const candidates = useMemo(
    () =>
      users.filter(
        (user) =>
          user.id !== currentUser.id &&
          user.username.toLowerCase().includes(query.toLowerCase()),
      ),
    [currentUser.id, query, users],
  )
  const isGroup = selected.length >= 2

  async function create() {
    if (!selected.length || (isGroup && !groupName.trim())) return
    setLoading(true)
    await createConversation(selected, isGroup ? groupName.trim() : undefined)
    onClose()
  }

  return (
    <Modal
      onClose={onClose}
      subtitle="Escolha uma ou mais pessoas para começar."
      title="Nova conversa"
    >
      <div className="modal-body">
        <label className="search-field">
          <Icon name="search" size={17} />
          <Input
            aria-label="Buscar pessoas"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar pessoas"
            value={query}
          />
        </label>
        <div className="selection-summary">
          <span>
            {selected.length
              ? `${selected.length} selecionado${
                  selected.length > 1 ? "s" : ""
                }`
              : "Selecione participantes"}
          </span>
          <span className="text-accent">
            {isGroup
              ? "Conversa em grupo"
              : selected.length === 1
                ? "Conversa direta"
                : ""}
          </span>
        </div>
        <div className="user-picker">
          {candidates.map((user) => {
            const checked = selected.includes(user.id)
            return (
              <label
                className={`user-option ${
                  checked ? "user-option-selected" : ""
                }`}
                key={user.id}
              >
                <input
                  checked={checked}
                  className="sr-only"
                  onChange={() =>
                    setSelected((current) =>
                      checked
                        ? current.filter((id) => id !== user.id)
                        : [...current, user.id],
                    )
                  }
                  type="checkbox"
                />
                <Avatar name={user.username} size="sm" />
                <span className="flex-1 text-sm font-medium text-primary">
                  {user.username}
                </span>
                <span
                  className={`check-circle ${
                    checked ? "check-circle-selected" : ""
                  }`}
                >
                  {checked && <Icon name="check" size={14} />}
                </span>
              </label>
            )
          })}
        </div>
        {isGroup && (
          <div className="mt-4">
            <label className="field-label" htmlFor="group-name">
              Nome do grupo
            </label>
            <Input
              id="group-name"
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Ex.: Equipe de produto"
              value={groupName}
            />
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} variant="ghost">
          Cancelar
        </Button>
        <Button
          disabled={
            !selected.length || (isGroup && !groupName.trim()) || loading
          }
          onClick={() => void create()}
        >
          {loading ? (
            <>
              <Icon className="animate-spin" name="spinner" /> Distribuindo
              chaves...
            </>
          ) : (
            <>
              <Icon name="lock" /> Criar conversa
            </>
          )}
        </Button>
      </div>
    </Modal>
  )
}
