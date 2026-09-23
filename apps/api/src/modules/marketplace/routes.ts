import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requirePermission } from '../../lib/authz.js';
import { AppError, notFound } from '../../lib/errors.js';

const listingInput = z.object({
  productId: z.uuid(), locationId: z.uuid(), title: z.string().trim().min(2).max(160), description: z.string().max(2000).optional(),
  quantity: z.number().int().positive(), minimumOrderQuantity: z.number().int().positive().default(1), unitPrice: z.number().positive(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()), expiresAt: z.iso.datetime().optional(),
});

async function notifyOrganization(app: Parameters<FastifyPluginAsync>[0], organizationId: string, type: string, title: string, message: string) {
  const members = await app.prisma.organizationMember.findMany({ where: { organizationId }, select: { userId: true } });
  if (members.length) await app.prisma.notification.createMany({ data: members.map(({ userId }) => ({ userId, organizationId, type, title, message })) });
  await app.redis.publish(`restockr:organization:${organizationId}`, JSON.stringify({ type, title, message, occurredAt: new Date().toISOString() }));
}

export const marketplaceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/listings', async (request) => {
    const query = z.object({ q: z.string().optional(), category: z.string().optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);
    const where: Prisma.MarketplaceListingWhereInput = {
      status: 'ACTIVE', expiresAt: { gt: new Date() },
      ...(query.category && { product: { category: query.category } }),
      ...(query.q && { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { sellerSku: { contains: query.q, mode: 'insensitive' } }] }),
    };
    const version = await app.redis.get('restockr:marketplace:version') ?? '0';
    const cacheKey = `restockr:marketplace:search:${version}:${Buffer.from(JSON.stringify(query)).toString('base64url')}`;
    const cached = await app.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as unknown;
    const [items, total] = await app.prisma.$transaction([
      app.prisma.marketplaceListing.findMany({ where, include: { product: { select: { name: true, category: true, brand: true, unit: true } }, location: { select: { city: true, country: true } }, sellerOrganization: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      app.prisma.marketplaceListing.count({ where }),
    ]);
    const response = { data: items.map((item) => ({ ...item, remainingQuantity: item.quantityAvailable - item.quantityReserved })), meta: { page: query.page, limit: query.limit, total } };
    await app.redis.set(cacheKey, JSON.stringify(response), 'EX', 30);
    return response;
  });

  app.get('/my-listings', async (request) => ({ data: await app.prisma.marketplaceListing.findMany({ where: { sellerOrganizationId: request.auth.organizationId }, include: { product: true, location: true }, orderBy: { createdAt: 'desc' } }) }));

  app.patch('/listings/:id', async (request) => {
    requirePermission(request.auth.role, 'marketplace:write');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const data = z.object({ title: z.string().trim().min(2).max(160).optional(), description: z.string().max(2000).nullable().optional(), minimumOrderQuantity: z.number().int().positive().optional(), unitPrice: z.number().positive().optional(), status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional() }).refine((value) => Object.keys(value).length > 0).parse(request.body);
    const listing = await app.prisma.marketplaceListing.findFirst({ where: { id, sellerOrganizationId: request.auth.organizationId } });
    if (!listing) return notFound('Listing');
    if (data.minimumOrderQuantity && data.minimumOrderQuantity > listing.quantityAvailable - listing.quantityReserved) throw new AppError(400, 'INVALID_MINIMUM_QUANTITY', 'Minimum order exceeds remaining quantity');
    const updated = await app.prisma.marketplaceListing.update({ where: { id }, data: Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) });
    await app.redis.incr('restockr:marketplace:version'); return { data: updated };
  });

  app.post('/listings', async (request, reply) => {
    requirePermission(request.auth.role, 'marketplace:write');
    const body = listingInput.parse(request.body);
    if (body.minimumOrderQuantity > body.quantity) throw new AppError(400, 'INVALID_MINIMUM_QUANTITY', 'Minimum order cannot exceed listing quantity');
    const listing = await app.prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findFirst({ where: { organizationId: request.auth.organizationId, productId: body.productId, locationId: body.locationId }, include: { product: true } });
      if (!inventory) return notFound('Inventory');
      const reserved = await tx.inventory.updateMany({ where: { id: inventory.id, quantityReserved: { lte: inventory.quantityOnHand - body.quantity } }, data: { quantityReserved: { increment: body.quantity } } });
      if (reserved.count !== 1) throw new AppError(409, 'INSUFFICIENT_INVENTORY', 'Not enough available inventory to publish this quantity');
      const created = await tx.marketplaceListing.create({ data: { sellerOrganizationId: request.auth.organizationId, productId: body.productId, locationId: body.locationId, sellerSku: inventory.product.sku, title: body.title, description: body.description ?? null, quantityAvailable: body.quantity, minimumOrderQuantity: body.minimumOrderQuantity, unitPrice: body.unitPrice, currency: body.currency, expiresAt: body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 30 * 86_400_000), status: 'ACTIVE' } });
      await tx.auditLog.create({ data: { organizationId: request.auth.organizationId, actorId: request.auth.userId, action: 'LISTING_CREATED', entity: 'MarketplaceListing', entityId: created.id, metadata: { quantity: body.quantity } } });
      return created;
    });
    await app.redis.incr('restockr:marketplace:version');
    return reply.code(201).send({ data: listing });
  });

  app.post('/listings/:id/requests', async (request, reply) => {
    requirePermission(request.auth.role, 'request:manage');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { quantity, destinationLocationId } = z.object({ quantity: z.number().int().positive(), destinationLocationId: z.uuid() }).parse(request.body);
    const idempotencyKey = z.string().min(8).max(160).parse(request.headers['idempotency-key']);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const result = await app.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${request.auth.organizationId}:${idempotencyKey}:stock-request`}))`;
      const replay = await tx.idempotencyKey.findUnique({ where: { organizationId_key_operation: { organizationId: request.auth.organizationId, key: idempotencyKey, operation: 'CREATE_STOCK_REQUEST' } } });
      if (replay) return replay.response as unknown as { stockRequest: { id: string; sellerOrganizationId: string }; reservation: unknown; replayed: boolean };
      const listing = await tx.marketplaceListing.findUnique({ where: { id }, include: { product: true } });
      if (!listing || listing.status !== 'ACTIVE' || !listing.expiresAt || listing.expiresAt <= new Date()) return notFound('Listing');
      if (listing.sellerOrganizationId === request.auth.organizationId) throw new AppError(400, 'OWN_LISTING', 'You cannot request stock from your own listing');
      const destination = await tx.location.findFirst({ where: { id: destinationLocationId, organizationId: request.auth.organizationId, isActive: true } });
      if (!destination) return notFound('Destination location');
      if (quantity < listing.minimumOrderQuantity) throw new AppError(400, 'BELOW_MINIMUM_ORDER', `Minimum order is ${listing.minimumOrderQuantity}`);
      const updated = await tx.marketplaceListing.updateMany({
        where: { id, status: 'ACTIVE', quantityReserved: { lte: listing.quantityAvailable - quantity } },
        data: { quantityReserved: { increment: quantity } },
      });
      if (updated.count !== 1) throw new AppError(409, 'INSUFFICIENT_LISTING_STOCK', 'Requested quantity is no longer available');
      const buyerProduct = await tx.product.upsert({
        where: { organizationId_sku: { organizationId: request.auth.organizationId, sku: listing.sellerSku } },
        update: {},
        create: { organizationId: request.auth.organizationId, sku: listing.sellerSku, name: listing.product.name, description: listing.product.description, category: listing.product.category, brand: listing.product.brand, unit: listing.product.unit, barcode: listing.product.barcode, costPrice: listing.unitPrice, defaultSalePrice: listing.unitPrice },
      });
      const stockRequest = await tx.stockRequest.create({ data: { listingId: id, buyerOrganizationId: request.auth.organizationId, sellerOrganizationId: listing.sellerOrganizationId, buyerProductId: buyerProduct.id, destinationLocationId, quantity, unitPrice: listing.unitPrice, status: 'RESERVED', expiresAt } });
      const reservation = await tx.reservation.create({ data: { listingId: id, requestId: stockRequest.id, quantity, expiresAt } });
      await tx.auditLog.create({ data: { organizationId: request.auth.organizationId, actorId: request.auth.userId, action: 'STOCK_RESERVED', entity: 'StockRequest', entityId: stockRequest.id, metadata: { listingId: id, quantity } } });
      const response = { stockRequest, reservation, replayed: false };
      await tx.idempotencyKey.create({ data: { organizationId: request.auth.organizationId, key: idempotencyKey, operation: 'CREATE_STOCK_REQUEST', response, expiresAt: new Date(Date.now() + 86_400_000) } });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result.replayed) await notifyOrganization(app, result.stockRequest.sellerOrganizationId, 'STOCK_REQUEST', 'New stock request', `A buyer requested ${quantity} units.`);
    await app.redis.incr('restockr:marketplace:version');
    return reply.code(result.replayed ? 200 : 201).header('Idempotency-Replayed', String(result.replayed)).send({ data: result });
  });
};
