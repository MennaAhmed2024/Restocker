import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => {
    const { q } = z.object({ q: z.string().optional() }).parse(request.query);
    const companies = await app.prisma.organization.findMany({ where: { id: { not: request.auth.organizationId }, status: 'ACTIVE', marketplaceVisible: true, ...(q && { name: { contains: q, mode: 'insensitive' } }) }, include: { _count: { select: { sellerListings: { where: { status: 'ACTIVE' } }, locations: { where: { isActive: true } } } } }, orderBy: { name: 'asc' } });
    return { data: companies.map(({ _count, ...company }) => ({ ...company, activeListings: _count.sellerListings, locations: _count.locations })) };
  });
};
