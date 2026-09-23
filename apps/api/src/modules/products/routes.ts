import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../lib/authz.js';
import { notFound } from '../../lib/errors.js';

const productInput = z.object({
  sku: z.string().trim().min(1).max(50), name: z.string().trim().min(2).max(160), description: z.string().max(2000).optional(),
  category: z.string().trim().min(1).max(80), brand: z.string().trim().max(80).optional(), unit: z.string().trim().min(1).max(20),
  barcode: z.string().trim().max(80).optional(), costPrice: z.coerce.number().nonnegative(), defaultSalePrice: z.coerce.number().nonnegative(),
  minimumStock: z.coerce.number().int().nonnegative().default(0), reorderPoint: z.coerce.number().int().nonnegative().default(0),
});
const productUpdate = productInput.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const productRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => {
    const query = z.object({ q: z.string().optional(), category: z.string().optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);
    const where = { organizationId: request.auth.organizationId, ...(query.category && { category: query.category }), ...(query.q && { OR: [{ name: { contains: query.q, mode: 'insensitive' as const } }, { sku: { contains: query.q, mode: 'insensitive' as const } }] }) };
    const [items, total] = await app.prisma.$transaction([
      app.prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      app.prisma.product.count({ where }),
    ]);
    return { data: items, meta: { page: query.page, limit: query.limit, total } };
  });
  app.post('/', async (request, reply) => {
    requirePermission(request.auth.role, 'product:write');
    const data = productInput.parse(request.body);
    const product = await app.prisma.product.create({ data: { ...data, description: data.description ?? null, brand: data.brand ?? null, barcode: data.barcode ?? null, organizationId: request.auth.organizationId } });
    await app.prisma.auditLog.create({ data: { organizationId: request.auth.organizationId, actorId: request.auth.userId, action: 'PRODUCT_CREATED', entity: 'Product', entityId: product.id } });
    return reply.code(201).send({ data: product });
  });
  app.get('/:id', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const product = await app.prisma.product.findFirst({ where: { id, organizationId: request.auth.organizationId }, include: { inventory: { include: { location: true } } } });
    return { data: product ?? notFound('Product') };
  });
  app.patch('/:id', async (request) => {
    requirePermission(request.auth.role, 'product:write');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const data = productUpdate.parse(request.body);
    const exists = await app.prisma.product.findFirst({ where: { id, organizationId: request.auth.organizationId } });
    if (!exists) return notFound('Product');
    const product = await app.prisma.product.update({ where: { id }, data: Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) });
    await app.prisma.auditLog.create({ data: { organizationId: request.auth.organizationId, actorId: request.auth.userId, action: 'PRODUCT_UPDATED', entity: 'Product', entityId: id } });
    return { data: product };
  });
  app.delete('/:id', async (request, reply) => {
    requirePermission(request.auth.role, 'product:write');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const product = await app.prisma.product.findFirst({ where: { id, organizationId: request.auth.organizationId }, include: { inventory: true, listings: true } });
    if (!product) return notFound('Product');
    if (product.inventory.some((item) => item.quantityOnHand !== 0 || item.quantityReserved !== 0) || product.listings.length) {
      return reply.code(409).send({ error: { code: 'PRODUCT_IN_USE', message: 'Clear inventory and listings before deleting this product' } });
    }
    await app.prisma.product.delete({ where: { id } });
    return reply.code(204).send();
  });
};
