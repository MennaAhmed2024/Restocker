import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { OrderStatus } from '@prisma/client';
import { canTransitionOrder } from '../../lib/order-state.js';
import { AppError, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../lib/authz.js';

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => {
    const { status } = z.object({ status: z.enum(['PENDING', 'RESERVED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED']).optional() }).parse(request.query);
    return { data: await app.prisma.order.findMany({ where: { OR: [{ buyerOrganizationId: request.auth.organizationId }, { sellerOrganizationId: request.auth.organizationId }], ...(status && { status }) }, include: { request: { include: { listing: true } }, buyerOrganization: { select: { name: true } }, sellerOrganization: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }) };
  });
  app.get('/:id', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const order = await app.prisma.order.findFirst({ where: { id, OR: [{ buyerOrganizationId: request.auth.organizationId }, { sellerOrganizationId: request.auth.organizationId }] }, include: { request: { include: { listing: true } }, statusHistory: { orderBy: { createdAt: 'asc' } } } });
    return { data: order ?? notFound('Order') };
  });
  app.post('/:id/status', async (request) => {
    requirePermission(request.auth.role, 'request:manage');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { status } = z.object({ status: z.enum(['PREPARING', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED']) }).parse(request.body);
    const updated = await app.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, OR: [{ buyerOrganizationId: request.auth.organizationId }, { sellerOrganizationId: request.auth.organizationId }] }, include: { request: { include: { listing: true, reservation: true } } } });
      if (!order) return notFound('Order');
      const sellerActions = ['PREPARING', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
      const buyerActions = ['COMPLETED', 'CANCELLED'];
      const ownsSellerSide = order.sellerOrganizationId === request.auth.organizationId;
      if (!(ownsSellerSide ? sellerActions : buyerActions).includes(status)) throw new AppError(403, 'ORDER_SIDE_FORBIDDEN', 'This order action belongs to the other trading party');
      if (!canTransitionOrder(order.status, status as OrderStatus)) throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Cannot move order from ${order.status} to ${status}`);
      if (status === 'CANCELLED') {
        await tx.marketplaceListing.update({ where: { id: order.request.listingId }, data: { quantityReserved: { decrement: order.request.quantity } } });
        if (order.request.reservation) await tx.reservation.update({ where: { id: order.request.reservation.id }, data: { status: 'RELEASED' } });
        await tx.stockRequest.update({ where: { id: order.requestId }, data: { status: 'CANCELLED' } });
      }
      if (status === 'COMPLETED') {
        const sellerInventory = await tx.inventory.update({ where: { productId_locationId: { productId: order.request.listing.productId, locationId: order.request.listing.locationId } }, data: { quantityOnHand: { decrement: order.request.quantity }, quantityReserved: { decrement: order.request.quantity } } });
        const buyerInventory = await tx.inventory.upsert({ where: { productId_locationId: { productId: order.request.buyerProductId, locationId: order.request.destinationLocationId } }, create: { organizationId: order.buyerOrganizationId, productId: order.request.buyerProductId, locationId: order.request.destinationLocationId, quantityOnHand: order.request.quantity }, update: { quantityOnHand: { increment: order.request.quantity } } });
        const listing = await tx.marketplaceListing.update({ where: { id: order.request.listingId }, data: { quantityAvailable: { decrement: order.request.quantity }, quantityReserved: { decrement: order.request.quantity } } });
        if (listing.quantityAvailable === 0) await tx.marketplaceListing.update({ where: { id: listing.id }, data: { status: 'SOLD_OUT' } });
        await tx.inventoryMovement.createMany({ data: [
          { organizationId: order.sellerOrganizationId, productId: order.request.listing.productId, locationId: order.request.listing.locationId, type: 'B2B_OUT', quantity: -order.request.quantity, balanceAfter: sellerInventory.quantityOnHand, referenceType: 'Order', referenceId: order.id, actorId: request.auth.userId },
          { organizationId: order.buyerOrganizationId, productId: order.request.buyerProductId, locationId: order.request.destinationLocationId, type: 'B2B_IN', quantity: order.request.quantity, balanceAfter: buyerInventory.quantityOnHand, referenceType: 'Order', referenceId: order.id, actorId: request.auth.userId },
        ] });
      }
      const result = await tx.order.update({ where: { id }, data: { status } });
      await tx.orderStatusHistory.create({ data: { orderId: id, fromStatus: order.status, toStatus: status, actorId: request.auth.userId } });
      return result;
    });
    await app.redis.publish(`restockr:organization:${updated.buyerOrganizationId}`, JSON.stringify({ type: 'ORDER_STATUS_CHANGED', orderId: id, status }));
    await app.redis.publish(`restockr:organization:${updated.sellerOrganizationId}`, JSON.stringify({ type: 'ORDER_STATUS_CHANGED', orderId: id, status }));
    await Promise.all([app.redis.del(`restockr:dashboard:${updated.buyerOrganizationId}`), app.redis.del(`restockr:dashboard:${updated.sellerOrganizationId}`)]);
    if (status === 'COMPLETED' || status === 'CANCELLED') await app.redis.incr('restockr:marketplace:version');
    return { data: updated };
  });
};
