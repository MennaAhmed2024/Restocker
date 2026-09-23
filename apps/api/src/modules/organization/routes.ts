import type { FastifyPluginAsync } from 'fastify';
import { hash } from 'argon2';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requirePermission } from '../../lib/authz.js';
import { AppError, notFound } from '../../lib/errors.js';

const roles = ['OWNER', 'ADMIN', 'INVENTORY_MANAGER', 'PROCUREMENT_MANAGER', 'EMPLOYEE', 'VIEWER'] as const;

export const organizationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', async (request) => ({ data: await app.prisma.organization.findUniqueOrThrow({ where: { id: request.auth.organizationId } }) }));
  app.patch('/', async (request) => {
    requirePermission(request.auth.role, 'organization:manage');
    const data = z.object({ name: z.string().trim().min(2).max(120).optional(), type: z.string().trim().min(2).max(60).optional(), country: z.string().trim().min(2).max(60).optional(), logo: z.url().nullable().optional(), marketplaceVisible: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0).parse(request.body);
    return { data: await app.prisma.organization.update({ where: { id: request.auth.organizationId }, data: Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) }) };
  });
  app.get('/members', async (request) => ({ data: await app.prisma.organizationMember.findMany({ where: { organizationId: request.auth.organizationId }, include: { user: { select: { id: true, fullName: true, email: true, createdAt: true } } }, orderBy: { createdAt: 'asc' } }) }));
  app.post('/members', async (request, reply) => {
    requirePermission(request.auth.role, 'organization:manage');
    const body = z.object({ fullName: z.string().trim().min(2).max(100), email: z.email().transform((v) => v.toLowerCase()), role: z.enum(roles).exclude(['OWNER']) }).parse(request.body);
    const temporaryPassword = `${randomBytes(8).toString('base64url')}Aa1`;
    const user = await app.prisma.user.upsert({ where: { email: body.email }, update: {}, create: { fullName: body.fullName, email: body.email, passwordHash: await hash(temporaryPassword) } });
    try {
      const member = await app.prisma.organizationMember.create({ data: { userId: user.id, organizationId: request.auth.organizationId, role: body.role }, include: { user: { select: { id: true, fullName: true, email: true } } } });
      await app.redis.rpush('restockr:jobs:email', JSON.stringify({ type: 'MEMBER_WELCOME', email: body.email, fullName: body.fullName, temporaryPassword }));
      return reply.code(201).send({ data: member });
    } catch (error: unknown) { if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new AppError(409, 'MEMBER_EXISTS', 'This user is already a member'); throw error; }
  });
  app.patch('/members/:id', async (request) => {
    requirePermission(request.auth.role, 'organization:manage');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { role } = z.object({ role: z.enum(roles).exclude(['OWNER']) }).parse(request.body);
    const member = await app.prisma.organizationMember.findFirst({ where: { id, organizationId: request.auth.organizationId } });
    if (!member) return notFound('Member');
    if (member.role === 'OWNER') throw new AppError(409, 'OWNER_IMMUTABLE', 'The owner role cannot be changed');
    return { data: await app.prisma.organizationMember.update({ where: { id }, data: { role } }) };
  });
  app.delete('/members/:id', async (request, reply) => {
    requirePermission(request.auth.role, 'organization:manage');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const member = await app.prisma.organizationMember.findFirst({ where: { id, organizationId: request.auth.organizationId } });
    if (!member) return notFound('Member');
    if (member.role === 'OWNER' || member.userId === request.auth.userId) throw new AppError(409, 'MEMBER_PROTECTED', 'Owner and current member cannot be removed');
    await app.prisma.organizationMember.delete({ where: { id } }); return reply.code(204).send();
  });
};
