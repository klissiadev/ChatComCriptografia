import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react"

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: "primary" | "secondary" | "ghost" | "danger"
}) {
  const variants = {
    primary: "bg-accent text-white hover:bg-accent-strong shadow-sm",
    secondary: "bg-elevated text-primary border border-line hover:bg-hover",
    ghost: "text-secondary hover:bg-hover hover:text-primary",
    danger: "text-danger bg-danger-soft hover:bg-danger-soft/70",
  }
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      className={`grid size-10 shrink-0 place-items-center rounded-xl text-secondary transition hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
      title={label}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-xl border border-line bg-elevated px-3.5 py-3 text-sm text-primary outline-none transition placeholder:text-tertiary focus:border-accent focus:ring-2 focus:ring-accent-soft ${className}`}
      {...props}
    />
  )
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string
  size?: "sm" | "md" | "lg"
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
  const sizes = {
    sm: "size-8 text-xs",
    md: "size-11 text-sm",
    lg: "size-14 text-base",
  }
  const colorIndex =
    name.split("").reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4
  return (
    <div className={`avatar avatar-${colorIndex} ${sizes[size]}`}>
      {initials}
    </div>
  )
}
