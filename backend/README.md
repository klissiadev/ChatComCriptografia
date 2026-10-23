# Backend — chat criptografado

Node + TypeScript, Express 5, Socket.IO, SQLite (better-sqlite3). O servidor só guarda bytes cifrados.

    cp .env.example .env   # exporte as variáveis (ou use `node --env-file=.env`)
    npm install
    npm run dev            # http://localhost:3000
    npm test               # integração: offline, ACK, duplicata, rotação de chave

## REST (todas exigem `Authorization: Bearer <jwt>`, exceto /auth/*)

| Método | Rota | Função |
|---|---|---|
| POST | /auth/register | `{username, password, publicKey}` → `{token, user}` |
| POST | /auth/login | `{username, password}` → `{token, user}` |
| GET | /users?q= | contatos + `online` |
| GET | /users/:id/public-key | chave pública de um usuário |
| GET | /users/public-keys?ids=a,b | chaves públicas em lote (para `distributeKey`) |
| GET | /conversations | minhas conversas (membros, `keyVersion`) |
| POST | /conversations | cria (2 = direct, 3+ = group) com chaves v1 |
| POST | /conversations/:id/members | adiciona ao grupo, rotaciona (`keyVersion = atual+1`) |
| DELETE | /conversations/:id/members/:userId | remove (admin) ou sai (`me`), rotaciona |
| GET | /conversations/:id/keys?version= | minhas chaves de sessão cifradas |
| GET | /conversations/:id/messages?afterSeq=&limit= | histórico paginado |

Erros: `{error, message, currentKeyVersion?}`. `409 STALE_KEY_VERSION` = alguém rotacionou antes: busque `GET /conversations`, refaça a rotação com a versão atual.

## Socket.IO

Conexão: `io(url, { auth: { token } })`. Tipos em `shared/types.ts`.

Cliente → servidor: `message:send` (com ack `SendAck`), `message:delivered`, `key:ack`.
Servidor → cliente: `message:new`, `message:status`, `key:update`, `conversation:updated`, `conversation:removed`, `presence:snapshot`, `presence:update`.

Ao reconectar o servidor reenvia, nesta ordem, chaves sem `key:ack` e mensagens sem `message:delivered`.
O cliente deve deduplicar por `message.id` e por `(conversationId, keyVersion)`, e responder sempre com o ACK.
