import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../http/command.js';
import { idParam, parse } from '../../http/validate.js';
import { deleteMessage, editMessage, getGroupConversation, getMessages, listConversations, markRead, sendMessage } from './conversations.js';

const body = z.string().trim().min(1, 'Bắt buộc').max(4000);
const mentionIds = z.array(z.uuid()).max(50).default([]);
const refs = z.array(z.object({ type: z.enum(['event', 'task', 'group']), id: z.uuid() })).max(20).optional();
const sendBody = z.object({
  clientMsgId: z.string().min(8).max(100),
  body,
  replyToId: z.uuid().optional(),
  mentionIds,
  refs,
  attachments: z.array(z.object({ key: z.string().min(10).max(400), filename: z.string().trim().min(1).max(255) })).max(10).optional(),
});
const editBody = z.object({ body, mentionIds, refs });
const readBody = z.object({ seq: z.number().int().min(0) });
const pageQuery = z.object({
  beforeSeq: z.coerce.number().int().min(1).optional(),
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type P = { orgId?: string; groupId?: string; conversationId?: string; messageId?: string };

export async function messagingRoutes(app: FastifyInstance) {
  const deps = { db: app.db, realtime: app.realtime };

  app.get<{ Params: P }>('/v1/organizations/:orgId/conversations', (req) =>
    listConversations(app.db, req.currentUser().id, idParam(req.params.orgId)),
  );
  app.get<{ Params: P }>('/v1/groups/:groupId/conversation', (req) =>
    getGroupConversation(app.db, req.currentUser().id, idParam(req.params.groupId)),
  );
  app.get<{ Params: P }>('/v1/conversations/:conversationId/messages', (req) =>
    getMessages(app.db, req.currentUser().id, idParam(req.params.conversationId), parse(pageQuery, req.query)),
  );
  app.post<{ Params: P }>('/v1/conversations/:conversationId/messages', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => {
      const r = await sendMessage(ctx, idParam(req.params.conversationId), parse(sendBody, req.body));
      return { status: r.created ? 201 : 200, body: r.message };
    }),
  );
  app.patch<{ Params: P }>('/v1/messages/:messageId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await editMessage(ctx, idParam(req.params.messageId), parse(editBody, req.body)) })),
  );
  app.delete<{ Params: P }>('/v1/messages/:messageId', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await deleteMessage(ctx, idParam(req.params.messageId)) })),
  );
  app.post<{ Params: P }>('/v1/conversations/:conversationId/read', (req, reply) =>
    runCommand(deps, req, reply, async (ctx) => ({ body: await markRead(ctx, idParam(req.params.conversationId), parse(readBody, req.body).seq) })),
  );
}
