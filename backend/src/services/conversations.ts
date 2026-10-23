import { randomUUID } from 'node:crypto';
import { SQL_NOW, type DB } from '../db';
import { HttpError } from '../errors';
import type { ConversationDTO, ConversationType, EncryptedKeyEntry, MemberDTO, SessionKeyDTO } from '../../../shared/types';

interface ConvRow {
  id: string; name: string | null; type: ConversationType;
  created_by: string; key_version: number; created_at: string;
}

export function activeMemberIds(db: DB, convId: string): string[] {
  return db
    .prepare<[string], { user_id: string }>(
      'SELECT user_id FROM participants WHERE conversation_id=? AND left_at IS NULL ORDER BY joined_at, rowid')
    .all(convId)
    .map((r) => r.user_id);
}

export function isActiveMember(db: DB, convId: string, userId: string): boolean {
  return !!db
    .prepare<[string, string], { x: number }>(
      'SELECT 1 AS x FROM participants WHERE conversation_id=? AND user_id=? AND left_at IS NULL')
    .get(convId, userId);
}

function loadConversation(db: DB, convId: string): ConvRow {
  const c = db.prepare<[string], ConvRow>('SELECT * FROM conversations WHERE id=?').get(convId);
  if (!c) throw new HttpError(404, 'CONVERSATION_NOT_FOUND');
  return c;
}

function roleOf(db: DB, convId: string, userId: string): 'admin' | 'member' {
  const r = db
    .prepare<[string, string], { role: 'admin' | 'member' }>(
      'SELECT role FROM participants WHERE conversation_id=? AND user_id=? AND left_at IS NULL')
    .get(convId, userId);
  if (!r) throw new HttpError(403, 'NOT_MEMBER');
  return r.role;
}

/** O conjunto de chaves enviado deve ter exatamente uma entrada por membro esperado. */
function assertKeySet(keys: EncryptedKeyEntry[], expected: string[]): void {
  const got = keys.map((k) => k.userId);
  const ok = new Set(got).size === got.length && got.length === expected.length && expected.every((id) => got.includes(id));
  if (!ok) {
    throw new HttpError(400, 'KEY_SET_MISMATCH', 'keys must have exactly one entry per member of the new membership', { expected });
  }
}

function assertNextVersion(conv: ConvRow, keyVersion: number | undefined): number {
  if (keyVersion !== conv.key_version + 1) {
    throw new HttpError(409, 'STALE_KEY_VERSION', `expected keyVersion ${conv.key_version + 1}`, { currentKeyVersion: conv.key_version });
  }
  return keyVersion;
}

function insertKeys(db: DB, convId: string, version: number, keys: EncryptedKeyEntry[], actorId: string): void {
  const stmt = db.prepare(
    'INSERT INTO session_keys (conversation_id, user_id, key_version, encrypted_key, delivered) VALUES (?,?,?,?,?)');
  // A cópia de quem gerou a chave já está com ele: nasce como entregue.
  for (const k of keys) stmt.run(convId, k.userId, version, k.encryptedKey, k.userId === actorId ? 1 : 0);
}

export function getConversationDTO(db: DB, convId: string): ConversationDTO {
  const c = loadConversation(db, convId);
  const members = db
    .prepare<[string], { user_id: string; username: string; role: MemberDTO['role'] }>(
      `SELECT p.user_id, u.username, p.role FROM participants p JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id=? AND p.left_at IS NULL ORDER BY p.joined_at, p.rowid`)
    .all(convId)
    .map((m) => ({ userId: m.user_id, username: m.username, role: m.role }));
  return { id: c.id, name: c.name, type: c.type, keyVersion: c.key_version, createdBy: c.created_by, createdAt: c.created_at, members };
}

export function listConversations(db: DB, userId: string): ConversationDTO[] {
  return db
    .prepare<[string], { conversation_id: string }>(
      'SELECT conversation_id FROM participants WHERE user_id=? AND left_at IS NULL ORDER BY joined_at, rowid')
    .all(userId)
    .map((r) => getConversationDTO(db, r.conversation_id));
}

/** Cria conversa (2 pessoas = direct, 3+ = group) e grava todas as chaves v1 numa transação só. */
export function createConversation(
  db: DB, creatorId: string,
  input: { name?: string; memberIds: string[]; keys: EncryptedKeyEntry[] },
): string {
  const members = [creatorId, ...new Set(input.memberIds.filter((id) => id !== creatorId))];
  if (members.length < 2) throw new HttpError(400, 'TOO_FEW_MEMBERS');

  return db.transaction(() => {
    const found = db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${members.map(() => '?').join(',')})`)
      .get(...members) as { n: number };
    if (found.n !== members.length) throw new HttpError(404, 'USER_NOT_FOUND');
    assertKeySet(input.keys, members);

    const id = randomUUID();
    const type: ConversationType = members.length === 2 ? 'direct' : 'group';
    db.prepare('INSERT INTO conversations (id, name, type, created_by, key_version) VALUES (?,?,?,?,1)')
      .run(id, type === 'group' ? input.name ?? null : null, type, creatorId);
    const p = db.prepare('INSERT INTO participants (conversation_id, user_id, role) VALUES (?,?,?)');
    for (const m of members) p.run(id, m, m === creatorId ? 'admin' : 'member');
    insertKeys(db, id, 1, input.keys, creatorId);
    return id;
  })();
}

export interface MembershipResult { keyVersion: number | null; memberIds: string[]; removedUserId?: string }

/** Adiciona membro a um GRUPO: rotaciona a chave (version+1) e distribui para todos que ficam + o novo. */
export function addMember(
  db: DB, actorId: string, convId: string,
  input: { userId: string; keyVersion: number; keys: EncryptedKeyEntry[] },
): MembershipResult {
  return db.transaction((): MembershipResult => {
    const conv = loadConversation(db, convId);
    if (roleOf(db, convId, actorId) !== 'admin') throw new HttpError(403, 'ADMIN_ONLY');
    if (conv.type === 'direct') {
      throw new HttpError(409, 'DIRECT_CANNOT_ADD', 'create a new conversation with all members instead');
    }
    const exists = db.prepare('SELECT 1 FROM users WHERE id=?').get(input.userId);
    if (!exists) throw new HttpError(404, 'USER_NOT_FOUND');
    if (isActiveMember(db, convId, input.userId)) throw new HttpError(409, 'ALREADY_MEMBER');

    const version = assertNextVersion(conv, input.keyVersion);
    const after = [...activeMemberIds(db, convId), input.userId];
    assertKeySet(input.keys, after);

    db.prepare(
      `INSERT INTO participants (conversation_id, user_id, role) VALUES (?,?, 'member')
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET left_at=NULL, role='member', joined_at=${SQL_NOW}`)
      .run(convId, input.userId);
    db.prepare('UPDATE conversations SET key_version=? WHERE id=?').run(version, convId);
    insertKeys(db, convId, version, input.keys, actorId);
    return { keyVersion: version, memberIds: after };
  })();
}

/**
 * Remove um membro (admin) ou sai do grupo (targetId === actorId).
 * Gera nova versão de chave só para quem fica. Se ninguém sobrar, não há chave a distribuir.
 */
export function removeMember(
  db: DB, actorId: string, convId: string, targetId: string,
  input: { keyVersion?: number; keys?: EncryptedKeyEntry[] },
): MembershipResult {
  return db.transaction((): MembershipResult => {
    const conv = loadConversation(db, convId);
    const actorRole = roleOf(db, convId, actorId);
    if (targetId !== actorId && actorRole !== 'admin') throw new HttpError(403, 'ADMIN_ONLY');
    if (conv.type === 'direct') throw new HttpError(409, 'DIRECT_CANNOT_LEAVE');
    if (!isActiveMember(db, convId, targetId)) throw new HttpError(404, 'NOT_MEMBER');

    const remaining = activeMemberIds(db, convId).filter((id) => id !== targetId);
    let version: number | null = null;
    if (remaining.length > 0) {
      version = assertNextVersion(conv, input.keyVersion);
      assertKeySet(input.keys ?? [], remaining);
    }

    db.prepare(`UPDATE participants SET left_at=${SQL_NOW} WHERE conversation_id=? AND user_id=?`).run(convId, targetId);
    if (remaining.length > 0 && version !== null) {
      // sem admin sobrando: promove o membro mais antigo
      db.prepare(
        `UPDATE participants SET role='admin' WHERE conversation_id=? AND user_id=
           (SELECT user_id FROM participants WHERE conversation_id=? AND left_at IS NULL ORDER BY joined_at, rowid LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM participants WHERE conversation_id=? AND left_at IS NULL AND role='admin')`)
        .run(convId, convId, convId);
      db.prepare('UPDATE conversations SET key_version=? WHERE id=?').run(version, convId);
      insertKeys(db, convId, version, input.keys ?? [], actorId);
    }
    return { keyVersion: version, memberIds: remaining, removedUserId: targetId };
  })();
}

export function getSessionKeys(db: DB, userId: string, convId: string, version?: number): SessionKeyDTO[] {
  if (!isActiveMember(db, convId, userId)) throw new HttpError(403, 'NOT_MEMBER');
  const rows = version === undefined
    ? db.prepare<[string, string], { key_version: number; encrypted_key: string }>(
        'SELECT key_version, encrypted_key FROM session_keys WHERE conversation_id=? AND user_id=? ORDER BY key_version').all(convId, userId)
    : db.prepare<[string, string, number], { key_version: number; encrypted_key: string }>(
        'SELECT key_version, encrypted_key FROM session_keys WHERE conversation_id=? AND user_id=? AND key_version=?').all(convId, userId, version);
  return rows.map((r) => ({ keyVersion: r.key_version, encryptedKey: r.encrypted_key }));
}

export function pendingKeys(db: DB, userId: string) {
  return db
    .prepare<[string], { conversation_id: string; key_version: number; encrypted_key: string }>(
      'SELECT conversation_id, key_version, encrypted_key FROM session_keys WHERE user_id=? AND delivered=0 ORDER BY created_at, rowid')
    .all(userId)
    .map((r) => ({ conversationId: r.conversation_id, keyVersion: r.key_version, encryptedKey: r.encrypted_key }));
}

export function markKeyDelivered(db: DB, userId: string, convId: string, version: number): void {
  db.prepare('UPDATE session_keys SET delivered=1 WHERE user_id=? AND conversation_id=? AND key_version=?').run(userId, convId, version);
}
