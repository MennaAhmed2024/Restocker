export const STOCK_HEALTH = ['OUT_OF_STOCK', 'CRITICAL', 'LOW', 'HEALTHY', 'OVERSTOCK', 'SURPLUS'] as const;
export type StockHealth = (typeof STOCK_HEALTH)[number];

export interface ApiEnvelope<T> { data: T; meta?: Record<string, unknown> }
export interface ApiErrorEnvelope { error: { code: string; message: string; requestId: string; details?: unknown } }

export interface StockHealthThresholds {
  criticalDays: number;
  lowDays: number;
  healthyDays: number;
  surplusDays: number;
}

export const DEFAULT_STOCK_THRESHOLDS: StockHealthThresholds = {
  criticalDays: 3,
  lowDays: 7,
  healthyDays: 30,
  surplusDays: 60,
};
