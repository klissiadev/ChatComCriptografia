import { useState } from "react"
import { useChat } from "../context/ChatContext"
import { Button, IconButton } from "./ui"
import { Icon } from "./Icon"

export function DeveloperPanel() {
  const { connection, setConnection, simulateFailedSend } = useChat()
  const [open, setOpen] = useState(false)
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
            Ações reais sobre a conexão com o servidor
          </div>
        </div>
        <IconButton label="Fechar painel" onClick={() => setOpen(false)}>
          <Icon name="x" size={16} />
        </IconButton>
      </div>
      <div className="mt-3 grid gap-2">
        <Button
          onClick={() =>
            setConnection(connection === "offline" ? "connected" : "offline")
          }
          variant="secondary"
        >
          <Icon name="cloud-off" />
          <span>
            {connection === "offline" ? "Restaurar conexão" : "Derrubar conexão"}
          </span>
        </Button>
        <Button onClick={simulateFailedSend} variant="secondary">
          Falhar próximo envio
        </Button>
      </div>
    </div>
  )
}