import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { verifyToken } from './auth';
import type { DB } from './db';
import type { Presence } from './presence';
import { markKeyDelivered, pendingKeys } from './services/conversations';
import { markDelivered, pendingMessages, storeMessage } from './services/messages';
import { messageSchema } from './validation';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../../shared/types';

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const room = (userId: string) => `user:${userId}`;
const deliveredSchema = z.object({ messageId: z.string().min(1).max(64) });
const keyAckSchema = z.object({ conversationId: z.string().uuid(), keyVersion: z.number().int().min(1) });

export class Realtime {
  constructor(
    private io: TypedServer,
    private db: DB,
    private presence: Presence,
    private jwtSecret: string,
  ) {
    io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string') throw new Error('no token');
        const p = verifyToken(token, this.jwtSecret);
        if (!this.db.prepare('SELECT 1 FROM users WHERE id=?').get(p.sub)) throw new Error('unknown user');
        socket.data.userId = p.sub;
        socket.data.username = p.username;
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });
    io.on('connection', (s) => this.onConnection(s));
  }

  // ---- usado pelas rotas REST depois de um commit ----

  /** Empurra para os destinatários online as chaves ainda não confirmadas daquela versão. */
  pushKeys(conversationId: string, keyVersion: number): void {
    const rows = this.db
      .prepare<[string, number], { user_id: string; encrypted_key: string }>(
        'SELECT user_id, encrypted_key FROM session_keys WHERE conversation_id=? AND key_version=? AND delivered=0')
      .all(conversationId, keyVersion);
    for (const r of rows) {
      this.io.to(room(r.user_id)).emit('key:update', { conversationId, keyVersion, encryptedKey: r.encrypted_key });
    }
  }

  conversationUpdated(conversationId: string, userIds: string[]): void {
    for (const id of userIds) this.io.to(room(id)).emit('conversation:updated', { conversationId });
  }

  conversationRemoved(conversationId: string, userId: string): void {
    this.io.to(room(userId)).emit('conversation:removed', { conversationId });
  }

  // ---- ciclo de vida do socket ----

  private onConnection(socket: TypedSocket): void {
    const { userId } = socket.data;
    socket.join(room(userId));

    const becameOnline = this.presence.add(userId, socket.id);
    socket.emit('presence:snapshot', this.presence.list());
    if (becameOnline) socket.broadcast.emit('presence:update', { userId, online: true });

    this.flushPending(socket); // chaves antes das mensagens, para o cliente já poder decifrar

    socket.on('message:send', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = messageSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, code: 'INVALID' });
      try {
        const r = storeMessage(this.db, userId, parsed.data);
        if (!r.ok) return ack(r);
        // Também reenvia em duplicatas: cobre o caso "primeira entrega perdida, ainda sem ACK".
        for (const rid of r.pendingRecipients) this.io.to(room(rid)).emit('message:new', r.message);
        ack({ ok: true, seq: r.message.seq, createdAt: r.message.createdAt, duplicate: r.duplicate, deliveredTo: r.deliveredTo });
      } catch (e) {
        console.error('message:send failed', e);
        ack({ ok: false, code: 'INTERNAL' });
      }
    });

    socket.on('message:delivered', (payload) => {
      const p = deliveredSchema.safeParse(payload);
      if (!p.success) return;
      const r = markDelivered(this.db, p.data.messageId, userId);
      if (r) this.io.to(room(r.senderId)).emit('message:status', { messageId: p.data.messageId, userId, status: 'delivered' });
    });

    socket.on('key:ack', (payload) => {
      const p = keyAckSchema.safeParse(payload);
      if (p.success) markKeyDelivered(this.db, userId, p.data.conversationId, p.data.keyVersion);
    });

    socket.on('disconnect', () => {
      if (this.presence.remove(userId, socket.id)) this.io.emit('presence:update', { userId, online: false });
    });
  }

  /** Reconexão: entrega tudo que ficou sem ACK. O cliente deduplica por (conversationId, keyVersion) e por id. */
  private flushPending(socket: TypedSocket): void {
    const { userId } = socket.data;
    for (const k of pendingKeys(this.db, userId)) socket.emit('key:update', k);
    for (const m of pendingMessages(this.db, userId)) socket.emit('message:new', m);
  }
}
