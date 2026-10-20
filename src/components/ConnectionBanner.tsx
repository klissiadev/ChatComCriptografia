import { useEffect, useState } from "react"
import { useChat } from "../context/ChatContext"
import { Icon } from "./Icon"

export function ConnectionBanner() {
  const { connection } = useChat()
  const [showConnected, setShowConnected] = useState(false)
  const [previous, setPrevious] = useState(connection)

  useEffect(() => {
    if (previous !== "connected" && connection === "connected") {
      setShowConnected(true)
      const timer = window.setTimeout(() => setShowConnected(false), 2200)
      setPrevious(connection)
      return () => window.clearTimeout(timer)
    }
    setPrevious(connection)
  }, [connection, previous])

  if (connection === "connected" && !showConnected) return null
  const isOffline = connection === "offline"
  const text =
    connection === "reconnecting"
      ? "Reconectando..."
      : isOffline
        ? "Sem conexão. Suas mensagens serão enviadas ao reconectar"
        : "Conectado"

  return (
    <div
      aria-live="polite"
      className={`connection-banner ${
        connection === "connected"
          ? "connection-success"
          : isOffline
            ? "connection-error"
            : "connection-warning"
      }`}
    >
      {connection === "reconnecting" ? (
        <Icon className="animate-spin" name="spinner" size={15} />
      ) : (
        <span className="status-dot" />
      )}
      {text}
    </div>
  )
}
