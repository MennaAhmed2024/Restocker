import type { FastifyPluginAsync } from 'fastify';
import { hash, verify } from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const credentials = z.object({ email: z.email().transform((value) => value.toLowerCase()), password: z.string().min(8) });
const registerBody = credentials.extend({
  fullName: z.string().trim().min(2).max(100),
  confirmPassword: z.string(),
  companyName: z.string().trim().min(2).max(120),
  companyType: z.string().trim().min(2).max(60),
  country: z.string().trim().min(2).max(60),
  termsAccepted: z.literal(true),
}).superRefine(({ password, confirmPassword }, ctx) => {
  if (password !== confirmPassword) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' });
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password requires uppercase, lowercase, and a number' });
});

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const refreshDays = 7;

async function issueTokens(app: Parameters<FastifyPluginAsync>[0], userId: string, organizationId: string, role: 'OWNER' | 'ADMIN' | 'INVENTORY_MANAGER' | 'PROCUREMENT_MANAGER' | 'EMPLOYEE' | 'VIEWER', familyId: string = randomUUID()) {
  const accessToken = app.jwt.sign({ sub: userId, organizationId, role }, { expiresIn: app.config.ACCESS_TOKEN_EXPIRES_IN });
  const refreshToken = randomBytes(48).toString('base64url');
  await app.prisma.refreshToken.create({ data: { userId, tokenHash: digest(refreshToken), familyId, expiresAt: new Date(Date.now() + refreshDays * 86_400_000) } });
  return { accessToken, refreshToken, expiresIn: app.config.ACCESS_TOKEN_EXPIRES_IN };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/register', authLimit, async (request, reply) => {
    const body = registerBody.parse(request.body);
    const slug = `${body.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${randomBytes(3).toString('hex')}`;
    try {
      const result = await app.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { fullName: body.fullName, email: body.email, passwordHash: await hash(body.password) } });
        const organization = await tx.organization.create({ data: { name: body.companyName, slug, type: body.companyType, country: body.country } });
        await tx.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: 'OWNER' } });
        await tx.auditLog.create({ data: { organizationId: organization.id, actorId: user.id, action: 'ORGANIZATION_CREATED', entity: 'Organization', entityId: organization.id } });
        return { user, organization };
      });
      const tokens = await issueTokens(app, result.user.id, result.organization.id, 'OWNER');
      return reply.code(201).send({ data: { user: { id: result.user.id, fullName: result.user.fullName, email: result.user.email }, organization: result.organization, ...tokens } });
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
      throw error;
    }
  });

  app.post('/login', authLimit, async (request) => {
    const body = credentials.parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { email: body.email }, include: { memberships: { include: { organization: true }, take: 1 } } });
    const valid = user && await verify(user.passwordHash, body.password);
    if (!valid || !user.memberships[0]) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    const membership = user.memberships[0];
    const tokens = await issueTokens(app, user.id, membership.organizationId, membership.role);
    await app.prisma.auditLog.create({ data: { organizationId: membership.organizationId, actorId: user.id, action: 'USER_LOGIN', entity: 'User', entityId: user.id } });
    return { data: { user: { id: user.id, fullName: user.fullName, email: user.email }, organization: membership.organization, ...tokens } };
  });

  app.post('/refresh', async (request) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(32) }).parse(request.body);
    const stored = await app.prisma.refreshToken.findUnique({ where: { tokenHash: digest(refreshToken) }, include: { user: { include: { memberships: { take: 1 } } } } });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date() || !stored.user.memberships[0]) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    const membership = stored.user.memberships[0];
    await app.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return { data: await issueTokens(app, stored.userId, membership.organizationId, membership.role, stored.familyId) };
  });

  app.post('/logout', async (request, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(32) }).parse(request.body);
    await app.prisma.refreshToken.updateMany({ where: { tokenHash: digest(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const member = await app.prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: request.auth.userId, organizationId: request.auth.organizationId } },
      include: { user: { select: { id: true, fullName: true, email: true } }, organization: true },
    });
    if (!member) throw new AppError(401, 'MEMBERSHIP_REVOKED', 'Organization membership no longer exists');
    return { data: { user: member.user, organization: member.organization, role: member.role } };
  });

  app.post('/forgot-password', authLimit, async (request) => {
    const { email } = z.object({ email: z.email().transform((value) => value.toLowerCase()) }).parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { email } });
    let developmentToken: string | undefined;
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await app.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });
      await app.redis.rpush('restockr:jobs:email', JSON.stringify({ type: 'PASSWORD_RESET', email: user.email, fullName: user.fullName, token }));
      if (app.config.NODE_ENV === 'development') developmentToken = token;
    }
    return { data: { message: 'If the account exists, password reset instructions will be sent.', ...(developmentToken && { developmentToken }) } };
  });

  app.post('/reset-password', async (request) => {
    const { token, password } = z.object({ token: z.string().min(32), password: z.string().min(8).regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/) }).parse(request.body);
    await app.prisma.$transaction(async (tx) => {
      const stored = await tx.passwordResetToken.findUnique({ where: { tokenHash: digest(token) } });
      if (!stored || stored.usedAt || stored.expiresAt <= new Date()) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Reset token is invalid or expired');
      await tx.user.update({ where: { id: stored.userId }, data: { passwordHash: await hash(password) } });
      await tx.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });
      await tx.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { data: { message: 'Password updated. Sign in with your new password.' } };
  });

  app.post('/change-password', { preHandler: app.authenticate }, async (request) => {
    const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/) }).parse(request.body);
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: request.auth.userId } });
    if (!await verify(user.passwordHash, currentPassword)) throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
    await app.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(newPassword) } });
    await app.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { data: { message: 'Password changed. Other sessions have been signed out.' } };
  });
};
