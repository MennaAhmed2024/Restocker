import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../lib/authz.js';
import { AppError } from '../../lib/errors.js';
import { calculateStockHealth } from '../../lib/stock-health.js';

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => {
    const query = z.object({ q: z.string().optional(), locationId: z.uuid().optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);
    const where = { organizationId: request.auth.organizationId, ...(query.locationId && { locationId: query.locationId }), ...(query.q && { product: { OR: [{ name: { contains: query.q, mode: 'insensitive' as const } }, { sku: { contains: query.q, mode: 'insensitive' as const } }] } }) };
    const [items, total] = await app.prisma.$transaction([
      app.prisma.inventory.findMany({ where, include: { product: true, location: true }, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      app.prisma.inventory.count({ where }),
    ]);
    return { data: items.map((item) => ({ ...item, health: calculateStockHealth(item.quantityOnHand, item.quantityReserved, Number(item.averageDailySales)) })), meta: { page: query.page, limit: query.limit, total } };
  });

  app.get('/recommendations', async (request) => {
    const inventory = await app.prisma.inventory.findMany({ where: { organizationId: request.auth.organizationId }, include: { product: true, location: true } });
    const recommendations = inventory.flatMap((target) => {
      const targetHealth = calculateStockHealth(target.quantityOnHand, target.quantityReserved, Number(target.averageDailySales));
      if (!['OUT_OF_STOCK', 'CRITICAL', 'LOW'].includes(targetHealth.status)) return [];
      const source = inventory
        .filter((candidate) => candidate.productId === target.productId && candidate.locationId !== target.locationId)
        .map((candidate) => ({ candidate, health: calculateStockHealth(candidate.quantityOnHand, candidate.quantityReserved, Number(candidate.averageDailySales)) }))
        .filter(({ health }) => ['OVERSTOCK', 'SURPLUS'].includes(health.status))
        .sort((a, b) => b.health.available - a.health.available)[0];
      if (!source) return [];
      const needed = Math.max(target.product.reorderPoint - targetHealth.available, target.product.minimumStock);
      const movable = Math.max(0, source.health.available - source.candidate.product.reorderPoint);
      const quantity = Math.min(needed, movable);
      return quantity > 0 ? [{ productId: target.productId, productName: target.product.name, fromLocationId: source.candidate.locationId, fromLocation: source.candidate.location.name, toLocationId: target.locationId, toLocation: target.location.name, quantity, reason: `${targetHealth.status} at destination; ${source.health.status} at source` }] : [];
    });
    return { data: recommendations };
  });

  app.get('/:productId/movements', async (request) => {
    const { productId } = z.object({ productId: z.uuid() }).parse(request.params);
    const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(request.query);
    const product = await app.prisma.product.findFirst({ where: { id: productId, organizationId: request.auth.organizationId } });
    if (!product) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Product not found');
    const movements = await app.prisma.inventoryMovement.findMany({ where: { organizationId: request.auth.organizationId, productId, createdAt: { gte: new Date(Date.now() - query.days * 86_400_000) } }, orderBy: { createdAt: 'asc' } });
    const byDay = new Map<string, { incoming: number; outgoing: number; net: number }>();
    for (const movement of movements) {
      const day = movement.createdAt.toISOString().slice(0, 10);
      const bucket = byDay.get(day) ?? { incoming: 0, outgoing: 0, net: 0 };
      if (movement.quantity > 0) bucket.incoming += movement.quantity; else bucket.outgoing += Math.abs(movement.quantity);
      bucket.net += movement.quantity; byDay.set(day, bucket);
    }
    return { data: { movements, series: [...byDay].map(([date, values]) => ({ date, ...values })) } };
  });

  app.post('/adjust', async (request) => {
    requirePermission(request.auth.role, 'inventory:write');
    const body = z.object({ productId: z.uuid(), locationId: z.uuid(), delta: z.number().int().refine((value) => value !== 0), reason: z.string().trim().min(3).max(240) }).parse(request.body);
    const result = await app.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: body.productId, organizationId: request.auth.organizationId } });
      const location = await tx.location.findFirst({ where: { id: body.locationId, organizationId: request.auth.organizationId, isActive: true } });
      if (!product || !location) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Product or location not found');
      const current = await tx.inventory.findUnique({ where: { productId_locationId: { productId: body.productId, locationId: body.locationId } } });
      if (!current && body.delta < 0) throw new AppError(409, 'INSUFFICIENT_INVENTORY', 'Adjustment would make available inventory negative');
      if (!current) await tx.inventory.create({ data: { organizationId: request.auth.organizationId, productId: body.productId, locationId: body.locationId, quantityOnHand: body.delta } });
      else {
        const changed = await tx.inventory.updateMany({ where: { id: current.id, quantityOnHand: { gte: current.quantityReserved - body.delta } }, data: { quantityOnHand: { increment: body.delta } } });
        if (!changed.count) throw new AppError(409, 'INSUFFICIENT_INVENTORY', 'Adjustment would make available inventory negative');
      }
      const inventory = await tx.inventory.findUniqueOrThrow({ where: { productId_locationId: { productId: body.productId, locationId: body.locationId } } });
      await tx.inventoryMovement.create({ data: { organizationId: request.auth.organizationId, productId: body.productId, locationId: body.locationId, type: 'ADJUSTMENT', quantity: body.delta, balanceAfter: inventory.quantityOnHand, actorId: request.auth.userId, referenceType: body.reason } });
      return inventory;
    });
    await app.redis.del(`restockr:dashboard:${request.auth.organizationId}`);
    return { data: result };
  });
};
