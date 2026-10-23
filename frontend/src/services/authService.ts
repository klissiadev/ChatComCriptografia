import type { AuthResponse } from "../../../shared/types"
import { resetBackend } from "./backend.ts"
import { cryptoService } from "./cryptoService"
import { ApiError, request } from "./http.ts"
import { clearSession, getSession, isExpired, setSession } from "./session.ts"
import { socketService } from "./socketService"
import type { User } from "./types"

const FRIENDLY: Record<string, string> = {
  INVALID_CREDENTIALS: "Usuário ou senha inválidos",
  USERNAME_TAKEN: "Este nome de usuário já está em uso",
  VALIDATION_ERROR:
    "Usuário: 3 a 32 caracteres (letras, números, _ . -), sem espaços. Senha: mínimo de 8 caracteres.",
  INVALID_PUBLIC_KEY: "O servidor rejeitou a chave pública gerada neste dispositivo",
  NETWORK: "Não foi possível falar com o servidor",
}

function friendly(error: unknown): Error {
  if (error instanceof ApiError) return new Error(FRIENDLY[error.code] ?? error.message)
  return error instanceof Error ? error : new Error("Erro inesperado")
}

/** Compara as identidades pelos módulos/expoentes RSA (não depende da ordem das chaves do JSON). */
function sameIdentity(local: string, remote: string): boolean {
  try {
    const a = JSON.parse(local)
    const b = JSON.parse(remote)
    return ["exchange", "signing"].every((field) => a[field]?.n && a[field].n === b[field]?.n && a[field].e === b[field]?.e)
  } catch {
    return false
  }
}

export const authService = {
  async register(username: string, password: string): Promise<User> {
    const localId = crypto.randomUUID()
    const { publicKey } = await cryptoService.generateKeyPair(localId)
    let response: AuthResponse
    try {
      response = await request<AuthResponse>("/auth/register", "POST", { username, password, publicKey })
    } catch (error) {
      throw friendly(error)
    }
    // A privada foi gerada com um id local; agora ela passa a pertencer ao id definido pelo servidor.
    await cryptoService.bindIdentity(localId, response.user.id)
    setSession({ token: response.token, user: response.user })
    return response.user
  },

  async login(username: string, password: string): Promise<User> {
    let response: AuthResponse
    try {
      response = await request<AuthResponse>("/auth/login", "POST", { username, password })
    } catch (error) {
      throw friendly(error)
    }
    const local = await cryptoService.getPublicKey(response.user.id)
    if (!local) {
      throw new Error(
        "Este dispositivo não possui as chaves deste usuário. Entre pelo navegador em que a conta foi criada.",
      )
    }
    if (!sameIdentity(local, response.user.publicKey)) {
      throw new Error("As chaves guardadas neste dispositivo não correspondem às registradas no servidor.")
    }
    setSession({ token: response.token, user: response.user })
    return response.user
  },

  async logout(): Promise<void> {
    socketService.destroy()
    resetBackend()
    clearSession()
  },

  async getCurrentUser(): Promise<User | null> {
    const session = getSession()
    if (!session) return null
    if (isExpired(session.token) || !(await cryptoService.getPublicKey(session.user.id))) {
      clearSession()
      return null
    }
    return session.user
  },
}