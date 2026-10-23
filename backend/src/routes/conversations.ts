import { Router } from 'express';
import { z } from 'zod';
import { uid } from '../auth';
import type { DB } from '../db';
import type { Realtime } from '../realtime';
import {
  addMember, createConversation, getConversationDTO, getSessionKeys, listConversations, removeMember,
} from '../services/conversations';
import { history } from '../services/messages';
import { keyEntrySchema } from '../validation';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  memberIds: z.array(z.string().uuid()).min(1).max(49),
  keys: z.array(keyEntrySchema).min(2).max(50),
});
const addSchema = z.object({
  userId: z.string().uuid(),
  keyVersion: z.number().int().min(2),
  keys: z.array(keyEntrySchema).min(2).max(50),
});
const removeSchema = z.object({
  keyVersion: z.number().int().min(2).optional(),
  keys: z.array(keyEntrySchema).max(50).default([]),
});
const historyQuery = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const idParam = z.string().uuid();

export function conversationRoutes(db: DB, rt: Realtime): Router {
  const r = Router();

  r.get('/', (req, res) => {
    res.json(listConversations(db, uid(req)));
  });

  r.post('/', (req, res) => {
    const me = uid(req);
    const b = createSchema.parse(req.body);
    const id = createConversation(db, me, b);
    const dto = getConversationDTO(db, id);
    rt.pushKeys(id, 1);
    rt.conversationUpdated(id, dto.members.map((m) => m.userId).filter((u) => u !== me));
    res.status(201).json(dto);
  });

  // Chaves de sessão do próprio usuário (todas as versões, ou ?version=N). Útil quando chega mensagem de versão desconhecida.
  r.get('/:id/keys', (req, res) => {
    const version = req.query.version === undefined ? undefined : z.coerce.number().int().min(1).parse(req.query.version);
    res.json(getSessionKeys(db, uid(req), idParam.parse(req.params.id), version));
  });

  r.get('/:id/messages', (req, res) => {
    const q = historyQuery.parse(req.query);
    res.json(history(db, uid(req), idParam.parse(req.params.id), q.afterSeq, q.limit));
  });

  r.post('/:id/members', (req, res) => {
    const me = uid(req);
    const convId = idParam.parse(req.params.id);
    const b = addSchema.parse(req.body);
    const out = addMember(db, me, convId, b);
    rt.pushKeys(convId, out.keyVersion!);
    rt.conversationUpdated(convId, out.memberIds.filter((u) => u !== me));
    res.json(getConversationDTO(db, convId));
  });

  // DELETE /conversations/:id/members/:userId  (userId = "me" para sair)
  r.delete('/:id/members/:userId', (req, res) => {
    const me = uid(req);
    const convId = idParam.parse(req.params.id);
    const target = req.params.userId === 'me' ? me : idParam.parse(req.params.userId);
    const b = removeSchema.parse(req.body ?? {});
    const out = removeMember(db, me, convId, target, b);
    if (out.keyVersion !== null) rt.pushKeys(convId, out.keyVersion);
    rt.conversationRemoved(convId, target);
    rt.conversationUpdated(convId, out.memberIds.filter((u) => u !== me));
    res.json({ ok: true, keyVersion: out.keyVersion });
  });

  return r;
}
