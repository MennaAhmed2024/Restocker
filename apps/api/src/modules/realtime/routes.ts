import type { FastifyPluginAsync } from 'fastify';
import { Redis } from 'ioredis';
import { z } from 'zod';

const claims = z.object({ sub: z.uuid(), organizationId: z.uuid() });

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { websocket: true }, async (socket, request) => {
    try {
      const { token } = z.object({ token: z.string().min(1) }).parse(request.query);
      const identity = claims.parse(app.jwt.verify(token));
      const member = await app.prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId: identity.sub, organizationId: identity.organizationId } } });
      if (!member) return socket.close(1008, 'Membership revoked');
      const subscriber = new Redis(app.config.REDIS_URL);
      const channel = `restockr:organization:${identity.organizationId}`;
      await subscriber.subscribe(channel);
      subscriber.on('message', (_channel, payload) => { if (socket.readyState === socket.OPEN) socket.send(payload); });
      socket.send(JSON.stringify({ type: 'CONNECTED', occurredAt: new Date().toISOString() }));
      socket.on('close', () => void subscriber.quit());
      socket.on('error', () => void subscriber.quit());
    } catch { socket.close(1008, 'Authentication required'); }
  });
};
