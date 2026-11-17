export enum OrderStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CANCEL = 'cancel',
  SHIPPING = 'shipping',
  COMPLETED = 'completed',
}

export enum OrderType {
  TAKE_OUT = 'take-out',
  AT_TABLE = 'at-table',
  DELIVERY = 'delivery',
}

export const OrderAction = {
  INIT_ORDER_ITEM_SUCCESS: 'init.order_item.success',
};

export enum DiscountType {
  PROMOTION = 'promotion',
  VOUCHER = 'voucher',
  NONE = 'none',
}

// Reference of an order of this copy of the mono on the soft reference of
// accumulated_point_transaction_history_tbl (step 6.2). Rows of
// shared_user_db.order_tbl are trend orders, so the reference carries the trend
// prefix, the same as the backfill of migration v4.0.0-03. It lives here and
// not in the wallet: the wallet never knows a consumer name, it takes the
// reference from the calling service (internal routes, step 6.7). Used by the
// order based paths of AccumulatedPointService until they are cut from order/
// (step 6.15); leaves with order/ (step 6.17).
export const legacyTrendOrderRef = (orderSlug: string): string =>
  `trend:${orderSlug}`;
