import type { Role } from '@prisma/client';
import { forbidden } from './errors.js';

export type Permission = 'organization:manage' | 'product:write' | 'inventory:write' | 'marketplace:write' | 'request:manage' | 'read';
const grants: Record<Role, readonly Permission[]> = {
  OWNER: ['organization:manage', 'product:write', 'inventory:write', 'marketplace:write', 'request:manage', 'read'],
  ADMIN: ['organization:manage', 'product:write', 'inventory:write', 'marketplace:write', 'request:manage', 'read'],
  INVENTORY_MANAGER: ['product:write', 'inventory:write', 'marketplace:write', 'read'],
  PROCUREMENT_MANAGER: ['marketplace:write', 'request:manage', 'read'],
  EMPLOYEE: ['read'], VIEWER: ['read'],
};

export function requirePermission(role: Role, permission: Permission): void {
  if (!grants[role].includes(permission)) forbidden();
}
