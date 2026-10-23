import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { signToken } from '../auth';
import type { Config } from '../config';
import type { DB } from '../db';
import { HttpError } from '../errors';
import { assertRsaSpki, b64 } from '../validation';
import type { AuthResponse } from '../../../shared/types';

const registerSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_.-]{3,32}$/),
  password: z.string().min(8).max(128),
  publicKey: b64(2000),
});
const loginSchema = z.object({ username: z.string().min(1).max(32), password: z.string().min(1).max(128) });

interface UserRow { id: string; username: string; password_hash: string; public_key: string }
// Hash descartável para gastar o mesmo tempo quando o usuário não existe.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

export function authRoutes(db: DB, cfg: Pick<Config, 'jwtSecret' | 'jwtTtlSeconds'>): Router {
  const r = Router();

  const respond = (u: UserRow): AuthResponse => ({
    token: signToken({ sub: u.id, username: u.username }, cfg.jwtSecret, cfg.jwtTtlSeconds),
    user: { id: u.id, username: u.username, publicKey: u.public_key },
  });

  r.post('/register', async (req, res) => {
    const b = registerSchema.parse(req.body);
    assertRsaSpki(b.publicKey);
    const user: UserRow = { id: randomUUID(), username: b.username, password_hash: await bcrypt.hash(b.password, 10), public_key: b.publicKey };
    try {
      db.prepare('INSERT INTO users (id, username, password_hash, public_key) VALUES (?,?,?,?)')
        .run(user.id, user.username, user.password_hash, user.public_key);
    } catch (e) {
      if (e instanceof Error && 'code' in e && String(e.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new HttpError(409, 'USERNAME_TAKEN');
      }
      throw e;
    }
    res.status(201).json(respond(user));
  });

  r.post('/login', async (req, res) => {
    const b = loginSchema.parse(req.body);
    const u = db.prepare<[string], UserRow>('SELECT * FROM users WHERE username=?').get(b.username);
    const ok = await bcrypt.compare(b.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, 'INVALID_CREDENTIALS');
    res.json(respond(u));
  });

  return r;
}
