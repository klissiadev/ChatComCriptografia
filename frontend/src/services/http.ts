import { clearSession, getSession } from "./session"

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000"

export class ApiError extends Error {
  status: number
  code: string
  currentKeyVersion?: number

  constructor(status: number, code: string, message?: string, currentKeyVersion?: number) {
    super(message ?? code)
    this.status = status
    this.code = code
    this.currentKeyVersion = currentKeyVersion
  }
}

/** Envia JWT quando há sessão e lança ApiError para qualquer resposta HTTP sem sucesso. */
export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = getSession()?.token
  const headers: Record<string, string> = {}
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, "NETWORK", "Não foi possível falar com o servidor")
  }

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string; message?: string; currentKeyVersion?: number })
    | null

  if (!response.ok) {
    if (response.status === 401 && token && !path.startsWith("/auth/")) {
      clearSession()
      window.dispatchEvent(new Event("cifra:unauthorized"))
    }
    throw new ApiError(
      response.status,
      data?.error ?? `HTTP_${response.status}`,
      data?.message,
      data?.currentKeyVersion,
    )
  }
  return data as T
}