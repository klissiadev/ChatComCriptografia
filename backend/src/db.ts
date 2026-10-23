import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export const SQL_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

// O servidor só guarda dados cifrados: public_key, encrypted_key, ciphertext, iv, signature.
// A ordem das mensagens usa o rowid implícito de `messages` (cresce monotonicamente; nunca apagamos linhas).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  public_key    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (${SQL_NOW})
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  type        TEXT NOT NULL CHECK (type IN ('direct','group')),
  created_by  TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (${SQL_NOW})
);

CREATE TABLE IF NOT EXISTS participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at       TEXT NOT NULL DEFAULT (${SQL_NOW}),
  left_at         TEXT,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_keys (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  key_version     INTEGER NOT NULL,
  encrypted_key   TEXT NOT NULL,
  delivered       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (${SQL_NOW}),
  PRIMARY KEY (conversation_id, user_id, key_version)
);
CREATE INDEX IF NOT EXISTS idx_keys_pending ON session_keys(user_id) WHERE delivered = 0;

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sender_id       TEXT NOT NULL REFERENCES users(id),
  key_version     INTEGER NOT NULL,
  ciphertext      TEXT NOT NULL,
  iv              TEXT NOT NULL,
  signature       TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (${SQL_NOW})
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

-- Uma linha por destinatário: é a "fila de pendentes" (delivered_at NULL = ainda não confirmada).
CREATE TABLE IF NOT EXISTS message_receipts (
  message_id   TEXT NOT NULL REFERENCES messages(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  delivered_at TEXT,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_receipts_pending ON message_receipts(user_id) WHERE delivered_at IS NULL;
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
