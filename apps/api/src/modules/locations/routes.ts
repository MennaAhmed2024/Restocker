import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../lib/authz.js';
import { AppError, notFound } from '../../lib/errors.js';

const input = z.object({ name: z.string().trim().min(2).max(120), type: z.enum(['WAREHOUSE', 'BRANCH', 'STORE', 'DISTRIBUTION_CENTER']), country: z.string().trim().min(2), city: z.string().trim().min(2), address: z.string().trim().min(3), isActive: z.boolean().optional() });

export const locationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => ({ data: await app.prisma.location.findMany({ where: { organizationId: request.auth.organizationId }, orderBy: { name: 'asc' } }) }));
  app.post('/', async (request, reply) => {
    requirePermission(request.auth.role, 'organization:manage');
    const body = input.omit({ isActive: true }).parse(request.body);
    const location = await app.prisma.location.create({ data: { ...body, organizationId: request.auth.organizationId } });
    return reply.code(201).send({ data: location });
  });
  app.patch('/:id', async (request) => {
    requirePermission(request.auth.role, 'organization:manage');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const data = input.partial().refine((value) => Object.keys(value).length > 0).parse(request.body);
    const location = await app.prisma.location.findFirst({ where: { id, organizationId: request.auth.organizationId } });
    if (!location) return notFound('Location');
    return { data: await app.prisma.location.update({ where: { id }, data: Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) }) };
  });
  app.delete('/:id', async (request, reply) => {
    requirePermission(request.auth.role, 'organization:manage');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const location = await app.prisma.location.findFirst({ where: { id, organizationId: request.auth.organizationId }, include: { inventory: true } });
    if (!location) return notFound('Location');
    if (location.inventory.some((item) => item.quantityOnHand !== 0 || item.quantityReserved !== 0)) throw new AppError(409, 'LOCATION_IN_USE', 'Move or clear inventory before deactivating this location');
    await app.prisma.location.update({ where: { id }, data: { isActive: false } });
    return reply.code(204).send();
  });
};
