import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { Config } from '../config.js';

export const infrastructure = (config: Config) => fp(async (app) => {
  const prisma = new PrismaClient();
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
  await prisma.$connect();
  await redis.connect();
  app.decorate('prisma', prisma).decorate('redis', redis).decorate('config', config);
  app.addHook('onClose', async () => { await Promise.allSettled([prisma.$disconnect(), redis.quit()]); });
});
