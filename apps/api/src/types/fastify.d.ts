import type { PrismaClient, Role } from '@prisma/client';
import type Redis from 'ioredis';
import type { Config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance { prisma: PrismaClient; redis: Redis; config: Config; authenticate: (request: FastifyRequest) => Promise<void> }
  interface FastifyRequest { auth: { userId: string; organizationId: string; role: Role } }
}

declare module '@fastify/jwt' { interface FastifyJWT { payload: { sub: string; organizationId: string; role: Role }; user: { sub: string; organizationId: string; role: Role } } }
