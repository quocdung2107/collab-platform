import type { FastifyInstance } from 'fastify';
import { idParam } from '../../http/validate.js';
import { getMemberProfile } from './profile.js';
import { getWorkspace } from './workspace.js';

/** My Workspace (F12): chỉ dữ liệu của chính người gọi. */
export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/v1/me/workspace', (req) => getWorkspace(app.db, req.currentUser().id));
  app.get<{ Params: { orgId: string; userId: string } }>('/v1/organizations/:orgId/members/:userId/profile', (req) =>
    getMemberProfile(app.db, req.currentUser().id, idParam(req.params.orgId), idParam(req.params.userId)),
  );
}
