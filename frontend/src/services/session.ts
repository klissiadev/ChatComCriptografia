import type { User } from "./types"

export type Session = { token: string; user: User }

// sessionStorage é por aba: permite logar com usuários diferentes em abas diferentes (útil na demo).
const KEY = "cifra:session"
let cached: Session | null | undefined

export function getSession(): Session | null {
  if (cached === undefined) {
    try {
      cached = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Session | null
    } catch {
      cached = null
    }
  }
  return cached
}

export function setSession(session: Session): void {
  cached = session
  sessionStorage.setItem(KEY, JSON.stringify(session))
}

export function clearSession(): void {
  cached = null
  sessionStorage.removeItem(KEY)
}

export function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number }
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}