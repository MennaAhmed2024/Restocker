import { describe, expect, it } from 'vitest';
import { requirePermission } from '../src/lib/authz.js';

describe('RBAC policy', () => {
  it('allows inventory managers to mutate inventory', () => expect(() => requirePermission('INVENTORY_MANAGER', 'inventory:write')).not.toThrow());
  it('prevents viewers from mutating inventory', () => expect(() => requirePermission('VIEWER', 'inventory:write')).toThrowError(/permission/i));
  it('keeps procurement separate from organization administration', () => expect(() => requirePermission('PROCUREMENT_MANAGER', 'organization:manage')).toThrowError(/permission/i));
});
