import type { OrderStatus } from '@prisma/client';

const transitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['RESERVED', 'CANCELLED', 'EXPIRED'],
  RESERVED: ['ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'IN_TRANSIT', 'CANCELLED'],
  READY_FOR_PICKUP: ['IN_TRANSIT', 'COMPLETED'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [], DECLINED: [], CANCELLED: [], EXPIRED: [],
};

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean => transitions[from].includes(to);
