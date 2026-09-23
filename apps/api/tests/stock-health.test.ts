import { describe, expect, it } from 'vitest';
import { calculateStockHealth } from '../src/lib/stock-health.js';

describe('calculateStockHealth', () => {
  it.each([
    [0, 0, 10, 'OUT_OF_STOCK'], [20, 0, 10, 'CRITICAL'], [50, 0, 10, 'LOW'],
    [200, 0, 10, 'HEALTHY'], [450, 0, 10, 'OVERSTOCK'], [700, 0, 10, 'SURPLUS'],
  ])('classifies %i on hand', (onHand, reserved, velocity, expected) => expect(calculateStockHealth(onHand, reserved, velocity).status).toBe(expected));
  it('handles zero demand without dividing by zero', () => expect(calculateStockHealth(20, 0, 0)).toEqual({ available: 20, daysOfStock: null, status: 'OVERSTOCK' }));
  it('never exposes negative availability', () => expect(calculateStockHealth(2, 3, 1).available).toBe(0));
});
