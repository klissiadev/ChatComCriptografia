import type { Verification } from "../services/types"
import { Icon } from "./Icon"

export function SecurityBadge({
  verification,
}: {
  verification: Verification
}) {
  if (verification === "waiting_key") {
    return (
      <span className="security-note text-warning">
        <Icon className="animate-spin" name="spinner" size={14} />
        Aguardando chave de segurança...
      </span>
    )
  }
  if (verification === "tampered") {
    return (
      <span className="security-note text-danger">
        <Icon name="alert" size={14} />
        Mensagem corrompida ou alterada
      </span>
    )
  }
  if (verification === "invalid_signature") {
    return (
      <span className="security-note text-danger">
        <Icon name="alert" size={14} />
        Não foi possível verificar o remetente desta mensagem
      </span>
    )
  }
  return <Icon className="message-lock" name="lock" size={11} />
}
