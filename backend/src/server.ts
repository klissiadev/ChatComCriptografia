import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { ZodError } from 'zod';
import { authMiddleware } from './auth';
import { openDb } from './db';
import { HttpError } from './errors';
import { Presence } from './presence';
import { Realtime, type TypedServer } from './realtime';
import { authRoutes } from './routes/auth';
import { conversationRoutes } from './routes/conversations';
import { userRoutes } from './routes/users';

export interface ServerOptions { dbFile: string; jwtSecret: string; corsOrigin: string; jwtTtlSeconds?: number }

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
  } else if (err instanceof ZodError) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: err.issues });
  } else if (typeof err?.status === 'number' && err.status < 500) {
    res.status(err.status).json({ error: 'BAD_REQUEST', message: err.message }); // ex.: JSON malformado
  } else {
    console.error(err);
    res.status(500).json({ error: 'INTERNAL' });
  }
};

export function createServer(opts: ServerOptions) {
  const db = openDb(opts.dbFile);
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: opts.corsOrigin }));
  app.use(express.json({ limit: '256kb' }));

  const httpServer = http.createServer(app);
  const io: TypedServer = new Server(httpServer, {
    cors: { origin: opts.corsOrigin },
    maxHttpBufferSize: 512 * 1024,
  });
  const presence = new Presence();
  const rt = new Realtime(io, db, presence, opts.jwtSecret);

  app.get('/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/auth', authRoutes(db, { jwtSecret: opts.jwtSecret, jwtTtlSeconds: opts.jwtTtlSeconds ?? 7 * 24 * 3600 }));
  app.use(authMiddleware(opts.jwtSecret));
  app.use('/users', userRoutes(db, presence));
  app.use('/conversations', conversationRoutes(db, rt));
  app.use(errorHandler);

  const close = async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    db.close();
  };
  return { app, httpServer, io, db, close };
}
