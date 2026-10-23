import type { PublicKeyDTO } from "../../../shared/types"
import { createCryptoIntegration } from "./cryptoIntegration"
import { request } from "./http"
import { getSession } from "./session"

// Cache em memória das identidades públicas: evita um GET por mensagem ao decifrar o histórico.
const publicKeys = new Map<string, string>()
const PUBLIC_KEY_PATH = /^\/users\/([0-9a-fA-F-]{36})\/public-key$/

export async function fetchPublicKey(userId: string): Promise<string> {
  const cached = publicKeys.get(userId)
  if (cached) return cached
  const dto = await request<PublicKeyDTO>(`/users/${userId}/public-key`)
  publicKeys.set(userId, dto.publicKey)
  return dto.publicKey
}

export function rememberPublicKeys(entries: PublicKeyDTO[]): void {
  for (const entry of entries) publicKeys.set(entry.userId, entry.publicKey)
}

/** request() que o adaptador usa: intercepta GET /users/:id/public-key para usar o cache. */
function cachedRequest<T>(path: string, method?: string, body?: unknown): Promise<T> {
  const match = PUBLIC_KEY_PATH.exec(path)
  if (match && (method ?? "GET") === "GET") {
    return fetchPublicKey(match[1]).then((publicKey) => ({ userId: match[1], publicKey }) as T)
  }
  return request<T>(path, method, body)
}

type Integration = ReturnType<typeof createCryptoIntegration>
let integration: Integration | null = null
let integrationUser = ""

/** Chame sempre como getCryptoIntegration().metodo(...) (os métodos usam `this`). */
export function getCryptoIntegration(): Integration {
  const session = getSession()
  if (!session) throw new Error("Sessão expirada. Entre novamente.")
  if (!integration || integrationUser !== session.user.id) {
    integration = createCryptoIntegration(session.user.id, cachedRequest)
    integrationUser = session.user.id
  }
  return integration
}

export function resetBackend(): void {
  integration = null
  integrationUser = ""
  publicKeys.clear()
}