import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../lib/authz.js';

export const requestRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/incoming', async (request) => ({ data: await app.prisma.stockRequest.findMany({ where: { sellerOrganizationId: request.auth.organizationId }, include: { listing: true, buyerOrganization: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }) }));
  app.get('/outgoing', async (request) => ({ data: await app.prisma.stockRequest.findMany({ where: { buyerOrganizationId: request.auth.organizationId }, include: { listing: true, sellerOrganization: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }) }));

  app.post('/:id/accept', async (request) => {
    requirePermission(request.auth.role, 'request:manage');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const order = await app.prisma.$transaction(async (tx) => {
      const stockRequest = await tx.stockRequest.findFirst({ where: { id, sellerOrganizationId: request.auth.organizationId }, include: { reservation: true, listing: true } });
      if (!stockRequest) return notFound('Request');
      if (stockRequest.status !== 'RESERVED' || !stockRequest.reservation || stockRequest.reservation.status !== 'ACTIVE') throw new AppError(409, 'REQUEST_NOT_RESERVABLE', 'Request is not awaiting acceptance');
      if (stockRequest.expiresAt <= new Date()) throw new AppError(409, 'RESERVATION_EXPIRED', 'Reservation has expired');
      await tx.reservation.update({ where: { id: stockRequest.reservation.id }, data: { status: 'CONFIRMED' } });
      await tx.stockRequest.update({ where: { id }, data: { status: 'ACCEPTED' } });
      const created = await tx.order.create({ data: { requestId: id, buyerOrganizationId: stockRequest.buyerOrganizationId, sellerOrganizationId: stockRequest.sellerOrganizationId, status: 'ACCEPTED', totalAmount: stockRequest.unitPrice.mul(stockRequest.quantity), currency: stockRequest.listing.currency } });
      await tx.orderStatusHistory.create({ data: { orderId: created.id, toStatus: 'ACCEPTED', actorId: request.auth.userId } });
      return created;
    });
    await app.redis.publish(`restockr:organization:${order.buyerOrganizationId}`, JSON.stringify({ type: 'REQUEST_ACCEPTED', orderId: order.id }));
    return { data: order };
  });

  app.post('/:id/decline', async (request) => {
    requirePermission(request.auth.role, 'request:manage');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const declined = await app.prisma.$transaction(async (tx) => {
      const stockRequest = await tx.stockRequest.findFirst({ where: { id, sellerOrganizationId: request.auth.organizationId }, include: { reservation: true } });
      if (!stockRequest) return notFound('Request');
      if (stockRequest.status !== 'RESERVED' || !stockRequest.reservation) throw new AppError(409, 'INVALID_REQUEST_STATUS', 'Only reserved requests can be declined');
      await tx.marketplaceListing.update({ where: { id: stockRequest.listingId }, data: { quantityReserved: { decrement: stockRequest.quantity } } });
      await tx.reservation.update({ where: { id: stockRequest.reservation.id }, data: { status: 'RELEASED' } });
      return tx.stockRequest.update({ where: { id }, data: { status: 'DECLINED' } });
    });
    await app.redis.incr('restockr:marketplace:version');
    return { data: declined };
  });
};
