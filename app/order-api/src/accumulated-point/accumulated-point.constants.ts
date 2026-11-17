export enum AccumulatedPointTransactionType {
  ADD = 'add',
  USE = 'use',
  RESERVE = 'reserve', // Temporary reserve when apply for order
  REFUND = 'refund', // Refund when order is cancelled
}

export enum AccumulatedPointTransactionStatus {
  PENDING = 'pending', // Pending (reserve)
  CONFIRMED = 'confirmed', // Confirmed (actually subtract/add points)
  CANCELLED = 'cancelled', // Cancelled - Points will be returned
}

// Soft reference of an order on accumulated_point_transaction_history_tbl
// (step 6.2): object_type_column, object_id_column, object_slug_column.
export const ACCUMULATED_POINT_OBJECT_TYPE_ORDER = 'ORDER';

// '<service>:<orderSlug>' -> '<orderSlug>'; a value without prefix is kept.
export const orderSlugOfRef = (ref?: string | null): string | undefined =>
  ref ? ref.slice(ref.indexOf(':') + 1) : undefined;
