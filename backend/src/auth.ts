import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { userId?: string }
  }
}

export interface TokenPayload { sub: string; username: string }

export function signToken(p: TokenPayload, secret: string, ttlSeconds: number): string {
  return jwt.sign({ username: p.username }, secret, { subject: p.sub, expiresIn: ttlSeconds, algorithm: 'HS256' });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const d = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof d === 'string' || !d.sub || typeof d.username !== 'string') throw new Error('bad token');
  return { sub: d.sub, username: d.username };
}

export function authMiddleware(secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'UNAUTHORIZED');
    try {
      req.userId = verifyToken(h.slice(7), secret).sub;
    } catch {
      throw new HttpError(401, 'UNAUTHORIZED');
    }
    next();
  };
}

export function uid(req: Request): string {
  if (!req.userId) throw new HttpError(401, 'UNAUTHORIZED');
  return req.userId;
}
