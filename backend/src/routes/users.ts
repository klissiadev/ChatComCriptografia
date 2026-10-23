import { Router } from 'express';
import { z } from 'zod';
import { uid } from '../auth';
import type { DB } from '../db';
import { HttpError } from '../errors';
import type { Presence } from '../presence';
import type { PublicKeyDTO, UserDTO } from '../../../shared/types';

export function userRoutes(db: DB, presence: Presence): Router {
  const r = Router();

  // GET /users?q=ana  -> lista de contatos (todos, menos eu), com presença
  r.get('/', (req, res) => {
    const q = z.string().max(32).default('').parse(req.query.q ?? '');
    const rows = db
      .prepare<[string, string], { id: string; username: string }>(
        `SELECT id, username FROM users WHERE id<>? AND username LIKE ? ESCAPE '\\' ORDER BY username LIMIT 200`)
      .all(uid(req), `%${q.replace(/[\\%_]/g, '\\$&')}%`);
    const out: UserDTO[] = rows.map((u) => ({ ...u, online: presence.isOnline(u.id) }));
    res.json(out);
  });

  // GET /users/public-keys?ids=a,b,c  -> várias chaves de uma vez (para montar o distributeKey)
  r.get('/public-keys', (req, res) => {
    const ids = z.array(z.string().uuid()).min(1).max(50).parse(String(req.query.ids ?? '').split(',').filter(Boolean));
    const rows = db
      .prepare(`SELECT id AS userId, username, public_key AS publicKey FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as PublicKeyDTO[];
    res.json(rows);
  });

  r.get('/:id/public-key', (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const u = db
      .prepare<[string], PublicKeyDTO>('SELECT id AS userId, username, public_key AS publicKey FROM users WHERE id=?')
      .get(id);
    if (!u) throw new HttpError(404, 'USER_NOT_FOUND');
    res.json(u);
  });

  return r;
}
