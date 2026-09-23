import { describe, expect, it } from 'vitest';
import { canTransitionOrder } from '../src/lib/order-state.js';
describe('order state machine', () => {
  it('allows the operational happy path', () => {
    expect(canTransitionOrder('ACCEPTED', 'PREPARING')).toBe(true);
    expect(canTransitionOrder('PREPARING', 'IN_TRANSIT')).toBe(true);
    expect(canTransitionOrder('IN_TRANSIT', 'DELIVERED')).toBe(true);
    expect(canTransitionOrder('DELIVERED', 'COMPLETED')).toBe(true);
  });
  it('rejects skipping states and terminal-state mutations', () => {
    expect(canTransitionOrder('ACCEPTED', 'COMPLETED')).toBe(false);
    expect(canTransitionOrder('COMPLETED', 'PREPARING')).toBe(false);
  });
});
