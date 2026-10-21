import { useEffect, useState } from "react"
import { cryptoService } from "../services/cryptoService"
import type { User } from "../services/types"
import { Icon } from "./Icon"
import { Modal } from "./Modal"
import { Button } from "./ui"

export function UserMenu({
  currentUser,
  dark,
  onTheme,
  onLogout,
  onClose,
}: {
  currentUser: User
  dark: boolean
  onTheme: () => void
  onLogout: () => void
  onClose: () => void
}) {
  const [fingerprint, setFingerprint] = useState("")
  useEffect(() => {
    void cryptoService
      .getFingerprint(currentUser.publicKey)
      .then(setFingerprint)
  }, [currentUser.publicKey])
  return (
    <Modal
      onClose={onClose}
      subtitle={currentUser.username}
      title="Sua conta"
      size="sm"
    >
      <div className="modal-body space-y-3">
        <div className="fingerprint-card">
          <Icon name="fingerprint" />
          <div>
            <span className="block text-xs text-secondary">
              Meu fingerprint
            </span>
            <code>{fingerprint}</code>
          </div>
        </div>
        <Button
          className="w-full justify-start"
          onClick={onTheme}
          variant="secondary"
        >
          <Icon name={dark ? "sun" : "moon"} /> Usar tema{" "}
          {dark ? "claro" : "escuro"}
        </Button>
        <Button
          className="w-full justify-start"
          onClick={onLogout}
          variant="danger"
        >
          <Icon name="logout" /> Sair
        </Button>
      </div>
    </Modal>
  )
}
