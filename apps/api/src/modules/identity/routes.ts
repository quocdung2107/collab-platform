import type { FastifyInstance } from 'fastify';
import { getMe } from './users.js';

export async function identityRoutes(app: FastifyInstance) {
  app.get('/v1/me', async (req) => getMe(app.db, req.currentUser()));
}
