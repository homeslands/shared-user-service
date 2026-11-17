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

// Unique indexes on the idempotency key of the history (ledger) and of the
// points row (step 6.3, migration v4.0.0-04).
export const HISTORY_KEY_INDEX = 'UQ_ap_history_external_transaction_id';
export const POINTS_KEY_INDEX = 'UQ_accumulated_point_external_transaction_id';

// /internal/accumulated-points/* (step 6.7): confirm and cancel-reservation
// are called with the key K of the reservation and write the rows K:confirm
// and K:cancel (the op suffix of trend-api.md 7.4 Z-2: one reference, several
// writes). A reservation key leaves room for the longer suffix (191 - 8).
export const RESERVATION_CONFIRM_SUFFIX = ':confirm';
export const RESERVATION_CANCEL_SUFFIX = ':cancel';
export const RESERVATION_KEY_MAX = 191 - RESERVATION_CONFIRM_SUFFIX.length;

// Expiry of a reservation (QD11, architect-http.md 1.8 point 6). The calling
// service sends expiresAt (the life of its pending object); when it does not,
// the reservation lives ACCUMULATED_POINT_RESERVATION_TTL_MINUTES (env), by
// default 30 minutes, twice the 15 minutes after which trend deletes a
// pending order. An expiresAt further than 24 hours away is refused: a
// reservation always ends (step 6.8 releases it).
export const RESERVATION_TTL_ENV = 'ACCUMULATED_POINT_RESERVATION_TTL_MINUTES';
export const RESERVATION_DEFAULT_TTL_MINUTES = 30;
export const RESERVATION_MAX_TTL_MINUTES = 24 * 60;

// '<service>:<reference>...' -> '<service>', the way the generated column of
// step 6.4 reads it (SUBSTRING_INDEX(..., ':', 1)): a value without ':' is its
// own service.
export const serviceOfRef = (ref: string): string => ref.split(':')[0];

// '<service>:<orderSlug>' -> '<orderSlug>'; a value without prefix is kept.
export const orderSlugOfRef = (ref?: string | null): string | undefined =>
  ref ? ref.slice(ref.indexOf(':') + 1) : undefined;
