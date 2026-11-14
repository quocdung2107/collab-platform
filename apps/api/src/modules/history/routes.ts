import type { FastifyInstance } from 'fastify';
import { idParam } from '../../http/validate.js';
import { eventHistory, taskHistory } from './history.js';

export async function historyRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/v1/events/:id/history', (req) => eventHistory(app.db, req.currentUser().id, idParam(req.params.id)));
  app.get<{ Params: { id: string } }>('/v1/tasks/:id/history', (req) => taskHistory(app.db, req.currentUser().id, idParam(req.params.id)));
}
