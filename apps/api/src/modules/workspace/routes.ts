import type { FastifyInstance } from 'fastify';
import { getWorkspace } from './workspace.js';

/** My Workspace (F12): chỉ dữ liệu của chính người gọi. */
export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/v1/me/workspace', (req) => getWorkspace(app.db, req.currentUser().id));
}
