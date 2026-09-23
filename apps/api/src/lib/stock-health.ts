import { DEFAULT_STOCK_THRESHOLDS, type StockHealth, type StockHealthThresholds } from '@restockr/shared';

export interface StockHealthResult { available: number; daysOfStock: number | null; status: StockHealth }

export function calculateStockHealth(
  onHand: number,
  reserved: number,
  averageDailySales: number,
  thresholds: StockHealthThresholds = DEFAULT_STOCK_THRESHOLDS,
): StockHealthResult {
  const available = Math.max(0, onHand - reserved);
  if (available === 0) return { available, daysOfStock: 0, status: 'OUT_OF_STOCK' };
  if (averageDailySales <= 0) return { available, daysOfStock: null, status: 'OVERSTOCK' };
  const daysOfStock = available / averageDailySales;
  const status: StockHealth = daysOfStock < thresholds.criticalDays ? 'CRITICAL'
    : daysOfStock < thresholds.lowDays ? 'LOW'
      : daysOfStock <= thresholds.healthyDays ? 'HEALTHY'
        : daysOfStock > thresholds.surplusDays ? 'SURPLUS' : 'OVERSTOCK';
  return { available, daysOfStock: Number(daysOfStock.toFixed(1)), status };
}
