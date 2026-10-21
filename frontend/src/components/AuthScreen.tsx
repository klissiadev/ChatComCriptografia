import { useEffect, useState } from "react"
import { authService } from "../services/authService"
import { cryptoService } from "../services/cryptoService"
import type { User } from "../services/types"
import { Icon } from "./Icon"
import { Button, Input } from "./ui"

type Mode = "login" | "register" | "generating" | "complete"

export function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (user: User) => void
}) {
  const [mode, setMode] = useState<Mode>("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [registeredUser, setRegisteredUser] = useState<User | null>(null)

  useEffect(() => {
    if (mode !== "generating") return
    const timer = window.setInterval(
      () =>
        setProgress((value) => Math.min(value + 7 + Math.random() * 12, 94)),
      260,
    )
    void cryptoService.generateKeyPair().then(() => {
      window.clearInterval(timer)
      setProgress(100)
      window.setTimeout(() => setMode("complete"), 400)
    })
    return () => window.clearInterval(timer)
  }, [mode])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    if (mode === "register") {
      const user = await authService.register(username.trim(), password)
      setRegisteredUser(user)
      setMode("generating")
    } else {
      const user = await authService.login(username.trim(), password)
      onAuthenticated(user)
    }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />
      <div className="auth-card">
        <div className="auth-brand">
          <span>
            <Icon name="shield" size={26} />
          </span>
          Cifra
        </div>
        {mode === "generating" || mode === "complete" ? (
          <div className="auth-step">
            <div
              className={`key-animation ${
                mode === "complete" ? "key-complete" : ""
              }`}
            >
              <Icon name={mode === "complete" ? "check" : "lock"} size={32} />
            </div>
            <h1 className="font-display text-2xl font-bold text-primary">
              {mode === "complete"
                ? "Chaves geradas"
                : "Gerando suas chaves de segurança..."}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              {mode === "complete"
                ? "Sua chave privada fica apenas neste dispositivo."
                : "Preparando uma identidade criptográfica exclusiva para você."}
            </p>
            <div className="progress-track">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="warning-card">
              <Icon name="alert" />
              <span>
                Limpar os dados do navegador apaga suas conversas antigas.
              </span>
            </div>
            {mode === "complete" && registeredUser && (
              <Button
                className="mt-5 w-full"
                onClick={() => onAuthenticated(registeredUser)}
              >
                Ir para minhas conversas
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="auth-copy">
              <h1 className="font-display text-3xl font-bold tracking-tight text-primary">
                {mode === "login"
                  ? "Bem-vindo de volta"
                  : "Crie sua conta segura"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {mode === "login"
                  ? "Entre para acessar suas conversas protegidas."
                  : "Suas chaves serão geradas neste dispositivo."}
              </p>
            </div>
            <form className="mt-7 space-y-4" onSubmit={submit}>
              <div>
                <label className="field-label" htmlFor="username">
                  Nome de usuário
                </label>
                <Input
                  autoComplete="username"
                  id="username"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Seu nome"
                  value={username}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="password">
                  Senha
                </label>
                <Input
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  id="password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  type="password"
                  value={password}
                />
              </div>
              <Button
                className="w-full"
                disabled={!username.trim() || !password || loading}
                type="submit"
              >
                {loading ? (
                  <>
                    <Icon className="animate-spin" name="spinner" /> Protegendo
                    acesso...
                  </>
                ) : mode === "login" ? (
                  "Entrar com segurança"
                ) : (
                  "Criar conta"
                )}
              </Button>
            </form>
            <div className="auth-switch">
              {mode === "login"
                ? "Ainda não tem uma conta?"
                : "Já possui uma conta?"}
              <button
                onClick={() => setMode(mode === "login" ? "register" : "login")}
              >
                {mode === "login" ? "Cadastre-se" : "Entrar"}
              </button>
            </div>
            <div className="auth-security">
              <Icon name="lock" size={13} /> Nem nós conseguimos ler suas
              mensagens.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
