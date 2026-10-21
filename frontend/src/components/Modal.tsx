import type { ReactNode } from "react"
import { Icon } from "./Icon"
import { IconButton } from "./ui"

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = "md",
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  size?: "sm" | "md" | "lg"
}) {
  return (
    <div aria-modal="true" className="modal-backdrop" role="dialog">
      <div className={`modal modal-${size}`}>
        <div className="modal-header">
          <div>
            <h2 className="font-display text-lg font-bold text-primary">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-sm text-secondary">{subtitle}</p>
            )}
          </div>
          <IconButton label="Fechar" onClick={onClose}>
            <Icon name="x" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}
