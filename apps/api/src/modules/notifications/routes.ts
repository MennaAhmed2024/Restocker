import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => ({ data: await app.prisma.notification.findMany({ where: { userId: request.auth.userId, organizationId: request.auth.organizationId }, orderBy: { createdAt: 'desc' }, take: 50 }) }));
  app.post('/:id/read', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const result = await app.prisma.notification.updateMany({ where: { id, userId: request.auth.userId, organizationId: request.auth.organizationId }, data: { readAt: new Date() } });
    if (!result.count) return notFound('Notification');
    return { data: { id, read: true } };
  });
};
