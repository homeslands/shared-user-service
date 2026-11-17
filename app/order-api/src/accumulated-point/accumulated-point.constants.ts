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

// Unique index of the active reservation invariant (step 6.4, migration
// v4.0.0-05): one reserve/pending row per (accumulated point, service). A
// second concurrent reservation fails on it with ER_DUP_ENTRY.
export const ACTIVE_RESERVATION_INDEX = 'UQ_ap_history_active_reservation';

// '<service>:<reference>...' -> '<service>', the way the generated column of
// step 6.4 reads it (SUBSTRING_INDEX(..., ':', 1)): a value without ':' is its
// own service.
export const serviceOfRef = (ref: string): string => ref.split(':')[0];

// '<service>:<orderSlug>' -> '<orderSlug>'; a value without prefix is kept.
export const orderSlugOfRef = (ref?: string | null): string | undefined =>
  ref ? ref.slice(ref.indexOf(':') + 1) : undefined;
