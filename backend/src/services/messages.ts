import { SQL_NOW, type DB } from '../db';
import { HttpError } from '../errors';
import type { EncryptedMessage, StoredMessage } from '../../../shared/types';
import { activeMemberIds, isActiveMember } from './conversations';

const cols = (p = '') =>
  `${p}rowid AS seq, ${p}id AS id, ${p}conversation_id AS conversationId, ${p}sender_id AS senderId,
   ${p}key_version AS keyVersion, ${p}ciphertext AS ciphertext, ${p}iv AS iv, ${p}signature AS signature, ${p}created_at AS createdAt`;

function getMessage(db: DB, id: string): StoredMessage | undefined {
  return db.prepare<[string], StoredMessage>(`SELECT ${cols()} FROM messages WHERE id=?`).get(id);
}

export type StoreResult =
  | { ok: true; message: StoredMessage; duplicate: boolean; pendingRecipients: string[]; deliveredTo: string[] }
  | { ok: false; code: 'NOT_MEMBER' | 'STALE_KEY' | 'INVALID'; currentKeyVersion?: number };

function receiptState(db: DB, messageId: string) {
  const rows = db
    .prepare<[string], { user_id: string; delivered_at: string | null }>(
      'SELECT user_id, delivered_at FROM message_receipts WHERE message_id=?')
    .all(messageId);
  return {
    pendingRecipients: rows.filter((r) => !r.delivered_at).map((r) => r.user_id),
    deliveredTo: rows.filter((r) => r.delivered_at).map((r) => r.user_id),
  };
}

/**
 * Grava a mensagem (já cifrada) e cria um recibo por destinatário, atomicamente.
 * Idempotente por message_id: reenvio do mesmo id devolve a mensagem existente (duplicate = true).
 */
export function storeMessage(db: DB, senderId: string, m: EncryptedMessage): StoreResult {
  return db.transaction((): StoreResult => {
    const existing = getMessage(db, m.id);
    if (existing) {
      if (existing.senderId !== senderId || existing.conversationId !== m.conversationId) {
        return { ok: false, code: 'INVALID' };
      }
      return { ok: true, message: existing, duplicate: true, ...receiptState(db, m.id) };
    }

    const conv = db.prepare<[string], { key_version: number }>('SELECT key_version FROM conversations WHERE id=?').get(m.conversationId);
    if (!conv || !isActiveMember(db, m.conversationId, senderId)) return { ok: false, code: 'NOT_MEMBER' };
    // Mensagem cifrada com chave antiga (ex.: rotação aconteceu no meio): cliente deve recifrar com a nova.
    if (m.keyVersion !== conv.key_version) {
      return { ok: false, code: 'STALE_KEY', currentKeyVersion: conv.key_version };
    }

    db.prepare(
      'INSERT INTO messages (id, conversation_id, sender_id, key_version, ciphertext, iv, signature) VALUES (?,?,?,?,?,?,?)')
      .run(m.id, m.conversationId, senderId, m.keyVersion, m.ciphertext, m.iv, m.signature);
    const recipients = activeMemberIds(db, m.conversationId).filter((id) => id !== senderId);
    const r = db.prepare('INSERT INTO message_receipts (message_id, user_id) VALUES (?,?)');
    for (const id of recipients) r.run(m.id, id);

    return { ok: true, message: getMessage(db, m.id)!, duplicate: false, pendingRecipients: recipients, deliveredTo: [] };
  })();
}

/** ACK do destinatário. Retorna o remetente se houve mudança de estado. */
export function markDelivered(db: DB, messageId: string, userId: string): { senderId: string } | null {
  const res = db
    .prepare(`UPDATE message_receipts SET delivered_at=${SQL_NOW} WHERE message_id=? AND user_id=? AND delivered_at IS NULL`)
    .run(messageId, userId);
  if (res.changes === 0) return null;
  const row = db.prepare<[string], { sender_id: string }>('SELECT sender_id FROM messages WHERE id=?').get(messageId);
  return row ? { senderId: row.sender_id } : null;
}

/** Fila de pendentes do usuário, na ordem em que o servidor recebeu. */
export function pendingMessages(db: DB, userId: string): StoredMessage[] {
  return db
    .prepare<[string], StoredMessage>(
      `SELECT ${cols('m.')} FROM message_receipts r JOIN messages m ON m.id = r.message_id
       WHERE r.user_id=? AND r.delivered_at IS NULL ORDER BY m.rowid`)
    .all(userId);
}

/** Histórico paginado. Só devolve mensagens de versões de chave que o usuário possui. */
export function history(db: DB, userId: string, convId: string, afterSeq: number, limit: number) {
  if (!isActiveMember(db, convId, userId)) throw new HttpError(403, 'NOT_MEMBER');
  const rows = db
    .prepare<[string, number, string, string, number], StoredMessage>(
      `SELECT ${cols('m.')} FROM messages m
       WHERE m.conversation_id=? AND m.rowid>?
         AND m.key_version IN (SELECT key_version FROM session_keys WHERE conversation_id=? AND user_id=?)
       ORDER BY m.rowid LIMIT ?`)
    .all(convId, afterSeq, convId, userId, limit + 1);
  return { messages: rows.slice(0, limit), hasMore: rows.length > limit };
}
