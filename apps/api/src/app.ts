import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { loadConfig, type Config } from './config.js';
import { infrastructure } from './plugins/infrastructure.js';
import { security } from './plugins/security.js';
import { errors } from './plugins/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { productRoutes } from './modules/products/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { marketplaceRoutes } from './modules/marketplace/routes.js';
import { requestRoutes } from './modules/requests/routes.js';
import { locationRoutes } from './modules/locations/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import { transferRoutes } from './modules/transfers/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { realtimeRoutes } from './modules/realtime/routes.js';
import { organizationRoutes } from './modules/organization/routes.js';
import { analyticsRoutes } from './modules/analytics/routes.js';
import { networkRoutes } from './modules/network/routes.js';
import { observability } from './plugins/observability.js';

export async function buildApp(config: Config = loadConfig()) {
  const instanceId = process.env.HOSTNAME ?? randomUUID().slice(0, 8);
  const app = Fastify({ logger: { level: config.NODE_ENV === 'test' ? 'silent' : 'info', redact: ['req.headers.authorization', 'body.password', 'body.refreshToken'] }, genReqId: (request) => String(request.headers['x-request-id'] ?? randomUUID()), bodyLimit: 1_048_576 });
  await app.register(infrastructure(config));
  await app.register(security(config));
  await app.register(errors);
  await app.register(observability);
  await app.register(websocket);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
    if (config.EXPOSE_INSTANCE_ID && config.NODE_ENV !== 'production') reply.header('X-ReStockr-Instance', instanceId);
  });
  app.get('/health/live', async () => ({ status: 'ok', instanceId }));
  app.get('/health/ready', async (_request, reply) => {
    try { await Promise.all([app.prisma.$queryRaw`SELECT 1`, app.redis.ping()]); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(productRoutes, { prefix: '/api/v1/products' });
  await app.register(inventoryRoutes, { prefix: '/api/v1/inventory' });
  await app.register(marketplaceRoutes, { prefix: '/api/v1/marketplace' });
  await app.register(requestRoutes, { prefix: '/api/v1/requests' });
  await app.register(locationRoutes, { prefix: '/api/v1/locations' });
  await app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
  await app.register(orderRoutes, { prefix: '/api/v1/orders' });
  await app.register(transferRoutes, { prefix: '/api/v1/transfers' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await app.register(realtimeRoutes, { prefix: '/api/v1/realtime' });
  await app.register(organizationRoutes, { prefix: '/api/v1/organization' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  await app.register(networkRoutes, { prefix: '/api/v1/network' });
  return app;
}
