import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import nodemailer from 'nodemailer';
import { aggregateAnalytics } from './modules/analytics/routes.js';

const config = loadConfig();
const prisma = new PrismaClient();
const redis = new Redis(config.REDIS_URL);
let running = true;
const mailer = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false });

async function processEmail() {
  const raw = await redis.lpop('restockr:jobs:email'); if (!raw) return false;
  const job = JSON.parse(raw) as { type: string; email: string; fullName: string; token?: string; temporaryPassword?: string };
  try {
    if (job.type === 'PASSWORD_RESET') await mailer.sendMail({ from: config.SMTP_FROM, to: job.email, subject: 'Reset your ReStockr password', text: `Hello ${job.fullName}, reset your password: ${config.APP_URL}/reset-password?token=${job.token}` });
    else await mailer.sendMail({ from: config.SMTP_FROM, to: job.email, subject: 'Welcome to ReStockr', text: `Hello ${job.fullName}, your temporary password is ${job.temporaryPassword}. Sign in at ${config.APP_URL}/login and change it immediately.` });
    return true;
  } catch (error) { await redis.rpush('restockr:jobs:email:failed', raw); throw error; }
}

async function refreshAnalytics() {
  const organizations = await prisma.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  for (const organization of organizations) await redis.set(`restockr:analytics:${organization.id}`, JSON.stringify(await aggregateAnalytics({ prisma } as Parameters<typeof aggregateAnalytics>[0], organization.id)), 'EX', 300);
}

async function releaseExpiredReservations() {
  const expired = await prisma.reservation.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: new Date() } }, take: 100 });
  for (const reservation of expired) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.reservation.updateMany({ where: { id: reservation.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      if (!claimed.count) return;
      await tx.marketplaceListing.update({ where: { id: reservation.listingId }, data: { quantityReserved: { decrement: reservation.quantity } } });
      await tx.stockRequest.update({ where: { id: reservation.requestId }, data: { status: 'EXPIRED' } });
    });
  }
  return expired.length;
}

async function run() {
  let nextAggregation = 0;
  while (running) {
    try { const released = await releaseExpiredReservations(); await processEmail(); if (Date.now() >= nextAggregation) { await refreshAnalytics(); nextAggregation = Date.now() + 60_000; } if (released) await redis.publish('restockr:worker', JSON.stringify({ type: 'RESERVATIONS_EXPIRED', count: released })); }
    catch (error) { console.error('reservation worker failed', error); }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

const shutdown = async () => { running = false; await Promise.allSettled([prisma.$disconnect(), redis.quit()]); process.exit(0); };
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
await run();
