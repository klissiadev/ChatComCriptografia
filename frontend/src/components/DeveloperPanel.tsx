import { useState } from "react"
import { useChat } from "../context/ChatContext"
import { Button, IconButton } from "./ui"
import { Icon } from "./Icon"

export function DeveloperPanel() {
  const {
    connection,
    setConnection,
    simulateIncoming,
    simulatePresence,
    simulateRemoval,
    simulateFailedSend,
  } = useChat()
  const [open, setOpen] = useState(false)
  const nextConnection =
    connection === "connected"
      ? "reconnecting"
      : connection === "reconnecting"
        ? "offline"
        : "connected"
  if (!open) {
    return (
      <IconButton
        className="dev-trigger"
        label="Abrir painel de demonstração"
        onClick={() => setOpen(true)}
      >
        <Icon name="code" />
      </IconButton>
    )
  }
  return (
    <div className="dev-panel">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-primary">
            Painel de demonstração
          </div>
          <div className="text-xs text-secondary">
            Simule eventos em tempo real
          </div>
        </div>
        <IconButton label="Fechar painel" onClick={() => setOpen(false)}>
          <Icon name="x" size={16} />
        </IconButton>
      </div>
      <div className="mt-3 grid gap-2">
        <Button
          onClick={() => setConnection(nextConnection)}
          variant="secondary"
        >
          <Icon name="cloud-off" />{" "}
          {connection === "connected"
            ? "Cair conexão"
            : connection === "reconnecting"
              ? "Ficar sem conexão"
              : "Restaurar conexão"}
        </Button>
        <Button onClick={simulateIncoming} variant="secondary">
          Receber mensagem
        </Button>
        <Button onClick={simulatePresence} variant="secondary">
          Alternar contato offline
        </Button>
        <Button onClick={simulateRemoval} variant="secondary">
          Remover membro + nova chave
        </Button>
        <Button onClick={simulateFailedSend} variant="secondary">
          Falhar próximo envio
        </Button>
      </div>
    </div>
  )
}
