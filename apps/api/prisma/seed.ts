import { PrismaClient, type Location, type Organization, type Product } from '@prisma/client';
import { hash } from 'argon2';

const prisma = new PrismaClient();
const passwordHash = await hash('Demo1234');

async function organization(slug: string, name: string): Promise<Organization> {
  const org = await prisma.organization.upsert({ where: { slug }, update: { name }, create: { slug, name, type: 'Retail & Distribution', country: 'Egypt' } });
  const email = `owner@${slug}.demo`;
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, fullName: `${name} Owner`, passwordHash } });
  await prisma.organizationMember.upsert({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } }, update: { role: 'OWNER' }, create: { userId: user.id, organizationId: org.id, role: 'OWNER' } });
  return org;
}

async function location(org: Organization, name: string, type: Location['type'], city: string): Promise<Location> {
  return prisma.location.upsert({ where: { organizationId_name: { organizationId: org.id, name } }, update: {}, create: { organizationId: org.id, name, type, country: 'Egypt', city, address: `${name}, ${city}` } });
}

async function product(org: Organization, sku: string, name: string, category: string, cost: number, sale: number): Promise<Product> {
  return prisma.product.upsert({ where: { organizationId_sku: { organizationId: org.id, sku } }, update: {}, create: { organizationId: org.id, sku, name, category, unit: 'unit', costPrice: cost, defaultSalePrice: sale, minimumStock: 10, reorderPoint: 20 } });
}

const nova = await organization('nova-retail', 'Nova Retail');
const tech = await organization('techsource', 'TechSource');
const office = await organization('officehub', 'OfficeHub');
const cairo = await location(nova, 'Cairo Warehouse', 'WAREHOUSE', 'Cairo');
const giza = await location(nova, 'Giza Branch', 'BRANCH', 'Giza');
const alex = await location(tech, 'Alexandria Warehouse', 'WAREHOUSE', 'Alexandria');
const officeCairo = await location(office, 'New Cairo Branch', 'BRANCH', 'Cairo');

const monitor = await product(nova, 'MON-HP24', 'HP Monitor 24"', 'Electronics', 3900, 4600);
const keyboard = await product(nova, 'KEY-MECH', 'Mechanical Keyboard', 'Accessories', 1200, 1650);
const charger = await product(tech, 'CHG-IP20', 'iPhone Charger', 'Accessories', 420, 650);
const chair = await product(office, 'CHR-ERG', 'Ergonomic Office Chair', 'Furniture', 2800, 3900);

for (const item of [
  [nova.id, monitor.id, cairo.id, 300, 0, 2], [nova.id, monitor.id, giza.id, 5, 0, 10], [nova.id, keyboard.id, cairo.id, 180, 0, 1.5],
  [tech.id, charger.id, alex.id, 600, 200, 4], [office.id, chair.id, officeCairo.id, 240, 80, 1],
] as const) {
  await prisma.inventory.upsert({ where: { productId_locationId: { productId: item[1], locationId: item[2] } }, update: { quantityOnHand: item[3], quantityReserved: item[4], averageDailySales: item[5] }, create: { organizationId: item[0], productId: item[1], locationId: item[2], quantityOnHand: item[3], quantityReserved: item[4], averageDailySales: item[5] } });
}

if (!await prisma.marketplaceListing.findFirst({ where: { sellerOrganizationId: tech.id, sellerSku: charger.sku, status: 'ACTIVE' } })) {
  await prisma.marketplaceListing.create({ data: { sellerOrganizationId: tech.id, productId: charger.id, locationId: alex.id, sellerSku: charger.sku, title: 'Original iPhone 20W Charger', description: 'New sealed stock, business invoice included.', quantityAvailable: 200, minimumOrderQuantity: 20, unitPrice: 450, currency: 'EGP', status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
}
if (!await prisma.marketplaceListing.findFirst({ where: { sellerOrganizationId: office.id, sellerSku: chair.sku, status: 'ACTIVE' } })) {
  await prisma.marketplaceListing.create({ data: { sellerOrganizationId: office.id, productId: chair.id, locationId: officeCairo.id, sellerSku: chair.sku, title: 'Ergonomic Mesh Office Chair', quantityAvailable: 80, minimumOrderQuantity: 5, unitPrice: 3200, currency: 'EGP', status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
}

console.log('Seed complete. Demo password: Demo1234');
await prisma.$disconnect();
