import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const prisma = testDatabaseUrl ? new PrismaClient({ datasourceUrl: testDatabaseUrl }) : new PrismaClient();
const suite = enabled ? describe : describe.skip;
let listingId = '';
let organizationId = '';

suite('reservation concurrency', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const organization = await prisma.organization.create({ data: { name: `Concurrency ${suffix}`, slug: `concurrency-${suffix}`, type: 'TEST', country: 'EG' } });
    organizationId = organization.id;
    const location = await prisma.location.create({ data: { organizationId, name: 'Test Warehouse', type: 'WAREHOUSE', country: 'EG', city: 'Cairo', address: 'Test' } });
    const product = await prisma.product.create({ data: { organizationId, sku: `SKU-${suffix}`, name: 'Race Product', category: 'Test', unit: 'unit', costPrice: 1, defaultSalePrice: 2 } });
    const listing = await prisma.marketplaceListing.create({ data: { sellerOrganizationId: organizationId, locationId: location.id, productId: product.id, sellerSku: product.sku, title: product.name, quantityAvailable: 100, minimumOrderQuantity: 10, unitPrice: 2, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) } });
    listingId = listing.id;
  });
  afterAll(async () => { if (listingId) await prisma.marketplaceListing.delete({ where: { id: listingId } }); if (organizationId) await prisma.organization.delete({ where: { id: organizationId } }); await prisma.$disconnect(); });
  it('allows only ten simultaneous reservations of ten units', async () => {
    const attempts = await Promise.all(Array.from({ length: 100 }, () => prisma.marketplaceListing.updateMany({ where: { id: listingId, quantityReserved: { lte: 90 } }, data: { quantityReserved: { increment: 10 } } })));
    expect(attempts.reduce((sum, result) => sum + result.count, 0)).toBe(10);
    const listing = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.quantityReserved).toBe(100);
    expect(listing.quantityAvailable - listing.quantityReserved).toBeGreaterThanOrEqual(0);
  });
});
