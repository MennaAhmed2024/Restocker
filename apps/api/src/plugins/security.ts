import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

const claimsSchema = z.object({ sub: z.uuid(), organizationId: z.uuid(), role: z.enum(['OWNER', 'ADMIN', 'INVENTORY_MANAGER', 'PROCUREMENT_MANAGER', 'EMPLOYEE', 'VIEWER']) });

export const security = (config: Config) => fp(async (app) => {
  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGIN.split(',').map((origin) => origin.trim()), credentials: true });
  await app.register(jwt, { secret: config.ACCESS_TOKEN_SECRET });
  await app.register(rateLimit, { redis: app.redis, global: false });
  app.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify();
      const token = claimsSchema.parse(request.user);
      request.auth = { userId: token.sub, organizationId: token.organizationId, role: token.role };
    } catch { throw new AppError(401, 'UNAUTHORIZED', 'Authentication required'); }
  });
});
