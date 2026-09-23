import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../lib/authz.js';

const transitions = {
  REQUESTED: ['APPROVED', 'CANCELLED'], APPROVED: ['PREPARING', 'CANCELLED'], PREPARING: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED'], RECEIVED: [], CANCELLED: [],
} as const;

export const transferRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => ({ data: await app.prisma.internalTransfer.findMany({ where: { organizationId: request.auth.organizationId }, include: { sourceLocation: true, destinationLocation: true, items: { include: { product: true } } }, orderBy: { createdAt: 'desc' } }) }));
  app.post('/', async (request, reply) => {
    requirePermission(request.auth.role, 'inventory:write');
    const body = z.object({ sourceLocationId: z.uuid(), destinationLocationId: z.uuid(), items: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().positive() })).min(1) }).parse(request.body);
    if (body.sourceLocationId === body.destinationLocationId) throw new AppError(400, 'SAME_LOCATION', 'Source and destination must be different');
    if (new Set(body.items.map((item) => item.productId)).size !== body.items.length) throw new AppError(400, 'DUPLICATE_PRODUCT', 'Each product may appear only once');
    const transfer = await app.prisma.$transaction(async (tx) => {
      const locations = await tx.location.count({ where: { id: { in: [body.sourceLocationId, body.destinationLocationId] }, organizationId: request.auth.organizationId, isActive: true } });
      if (locations !== 2) return notFound('Location');
      for (const item of body.items) {
        const inventory = await tx.inventory.findFirst({ where: { organizationId: request.auth.organizationId, locationId: body.sourceLocationId, productId: item.productId } });
        if (!inventory) return notFound('Inventory');
        const reserved = await tx.inventory.updateMany({ where: { id: inventory.id, quantityReserved: { lte: inventory.quantityOnHand - item.quantity } }, data: { quantityReserved: { increment: item.quantity } } });
        if (!reserved.count) throw new AppError(409, 'INSUFFICIENT_INVENTORY', 'A transfer item exceeds available stock');
      }
      return tx.internalTransfer.create({ data: { organizationId: request.auth.organizationId, sourceLocationId: body.sourceLocationId, destinationLocationId: body.destinationLocationId, createdById: request.auth.userId, items: { create: body.items } }, include: { items: true } });
    });
    return reply.code(201).send({ data: transfer });
  });
  app.post('/:id/status', async (request) => {
    requirePermission(request.auth.role, 'inventory:write');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { status } = z.object({ status: z.enum(['APPROVED', 'PREPARING', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']) }).parse(request.body);
    const result = await app.prisma.$transaction(async (tx) => {
      const transfer = await tx.internalTransfer.findFirst({ where: { id, organizationId: request.auth.organizationId }, include: { items: true } });
      if (!transfer) return notFound('Transfer');
      if (!(transitions[transfer.status] as readonly string[]).includes(status)) throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Cannot move transfer from ${transfer.status} to ${status}`);
      if (status === 'CANCELLED') {
        for (const item of transfer.items) await tx.inventory.update({ where: { productId_locationId: { productId: item.productId, locationId: transfer.sourceLocationId } }, data: { quantityReserved: { decrement: item.quantity } } });
      }
      if (status === 'RECEIVED') {
        for (const item of transfer.items) {
          const source = await tx.inventory.update({ where: { productId_locationId: { productId: item.productId, locationId: transfer.sourceLocationId } }, data: { quantityOnHand: { decrement: item.quantity }, quantityReserved: { decrement: item.quantity } } });
          const destination = await tx.inventory.upsert({ where: { productId_locationId: { productId: item.productId, locationId: transfer.destinationLocationId } }, create: { organizationId: transfer.organizationId, productId: item.productId, locationId: transfer.destinationLocationId, quantityOnHand: item.quantity }, update: { quantityOnHand: { increment: item.quantity } } });
          await tx.inventoryMovement.createMany({ data: [
            { organizationId: transfer.organizationId, productId: item.productId, locationId: transfer.sourceLocationId, type: 'INTERNAL_TRANSFER', quantity: -item.quantity, balanceAfter: source.quantityOnHand, referenceType: 'InternalTransfer', referenceId: transfer.id, actorId: request.auth.userId },
            { organizationId: transfer.organizationId, productId: item.productId, locationId: transfer.destinationLocationId, type: 'INTERNAL_TRANSFER', quantity: item.quantity, balanceAfter: destination.quantityOnHand, referenceType: 'InternalTransfer', referenceId: transfer.id, actorId: request.auth.userId },
          ] });
        }
      }
      return tx.internalTransfer.update({ where: { id }, data: { status } });
    });
    await app.redis.del(`restockr:dashboard:${request.auth.organizationId}`);
    return { data: result };
  });
};
