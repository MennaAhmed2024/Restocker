import type { FastifyPluginAsync } from 'fastify';

export async function aggregateAnalytics(app: Parameters<FastifyPluginAsync>[0], organizationId: string) {
  const [inventory, movements, orders] = await Promise.all([
    app.prisma.inventory.findMany({ where: { organizationId }, include: { product: true } }),
    app.prisma.inventoryMovement.findMany({ where: { organizationId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { createdAt: 'asc' } }),
    app.prisma.order.findMany({ where: { OR: [{ buyerOrganizationId: organizationId }, { sellerOrganizationId: organizationId }], createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  const stockValue = inventory.reduce((sum, row) => sum + row.quantityOnHand * Number(row.product.costPrice), 0);
  const byDay = new Map<string, { inbound: number; outbound: number }>();
  for (const movement of movements) { const day = movement.createdAt.toISOString().slice(0, 10); const b = byDay.get(day) ?? { inbound: 0, outbound: 0 }; if (movement.quantity > 0) b.inbound += movement.quantity; else b.outbound += Math.abs(movement.quantity); byDay.set(day, b); }
  return { generatedAt: new Date().toISOString(), stockValue, unitsOnHand: inventory.reduce((s, x) => s + x.quantityOnHand, 0), reservedUnits: inventory.reduce((s, x) => s + x.quantityReserved, 0), completedOrders: orders.filter((x) => x.status === 'COMPLETED').length, orderValue: orders.reduce((s, x) => s + Number(x.totalAmount), 0), movementSeries: [...byDay].map(([date, values]) => ({ date, ...values })), topProducts: inventory.sort((a, b) => b.quantityOnHand * Number(b.product.costPrice) - a.quantityOnHand * Number(a.product.costPrice)).slice(0, 5).map((x) => ({ id: x.productId, name: x.product.name, value: x.quantityOnHand * Number(x.product.costPrice), quantity: x.quantityOnHand })) };
}

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => {
    const key = `restockr:analytics:${request.auth.organizationId}`; const cached = await app.redis.get(key);
    if (cached) return { data: JSON.parse(cached), meta: { source: 'background-cache' } };
    const data = await aggregateAnalytics(app, request.auth.organizationId); await app.redis.set(key, JSON.stringify(data), 'EX', 300);
    return { data, meta: { source: 'live-fallback' } };
  });
};
