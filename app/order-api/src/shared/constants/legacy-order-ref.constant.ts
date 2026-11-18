// Reference of an order of this copy of the mono on the soft reference of
// accumulated_point_transaction_history_tbl (step 6.2). Rows of
// shared_user_db.order_tbl are trend orders, so the reference carries the trend
// prefix, the same as the backfill of migration v4.0.0-03.
//
// It stays out of the wallet folders: the wallet never knows a consumer name,
// the keyed internal routes (step 6.7) take the reference from the calling
// service. Moved here from order/order.constants.ts in step 6.15, when the
// wallet stopped importing order/. Only the order based paths of the mono copy
// use it (AccumulatedPointService addPointsForOrder, confirmPointsUsage,
// handleCancelReservation, called from job/, order/ and order-item/); it goes
// with them once those modules are removed (step 6.17).
export const legacyTrendOrderRef = (orderSlug: string): string =>
  `trend:${orderSlug}`;
