import type { FastifyPluginAsync } from 'fastify';
import { calculateStockHealth } from '../../lib/stock-health.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/summary', async (request) => {
    const key = `restockr:dashboard:${request.auth.organizationId}`;
    const cached = await app.redis.get(key);
    if (cached) return JSON.parse(cached) as unknown;
    const [inventory, activeRequests, openOffers, successfulTransfers, recentActivity] = await app.prisma.$transaction([
      app.prisma.inventory.findMany({ where: { organizationId: request.auth.organizationId }, include: { product: { select: { costPrice: true } } } }),
      app.prisma.stockRequest.count({ where: { OR: [{ buyerOrganizationId: request.auth.organizationId }, { sellerOrganizationId: request.auth.organizationId }], status: { in: ['PENDING', 'RESERVED'] } } }),
      app.prisma.marketplaceListing.count({ where: { sellerOrganizationId: request.auth.organizationId, status: 'ACTIVE' } }),
      app.prisma.internalTransfer.count({ where: { organizationId: request.auth.organizationId, status: 'RECEIVED' } }),
      app.prisma.auditLog.findMany({ where: { organizationId: request.auth.organizationId }, orderBy: { createdAt: 'desc' }, take: 6 }),
    ]);
    const stockStatuses = inventory.reduce<Record<string, number>>((counts, item) => { const status = calculateStockHealth(item.quantityOnHand, item.quantityReserved, Number(item.averageDailySales)).status; counts[status] = (counts[status] ?? 0) + 1; return counts; }, {});
    const totalInventory = inventory.reduce((sum, item) => sum + (item.quantityOnHand - item.quantityReserved) * Number(item.product.costPrice), 0);
    const response = { data: { totalInventory, activeRequests, openOffers, successfulTransfers, stockStatuses, recentActivity } };
    await app.redis.set(key, JSON.stringify(response), 'EX', 60);
    return response;
  });
};
