export const CREATE_NOTIFICATION_JOB = 'create-notification';

export enum NotificationType {
  ORDER = 'order',
  CARD_ORDER = 'card-order',
  VOUCHER = 'voucher',
  GIFT = 'gift',
}

export enum NotificationMessageCode {
  // voucher
  VOUCHER_BIRTHDAY_RECEIVED = 'voucher-birthday-received',
  VOUCHER_NEW_USER_RECEIVED = 'voucher-new-user-received',

  // gift
  GIFT_BIRTHDAY_RECEIVED = 'gift-birthday-received',

  // staff
  ORDER_NEEDS_PROCESSED = 'order-needs-processed',
  ORDER_NEEDS_DELIVERED = 'order-needs-delivered',
  ORDER_NEEDS_CANCELLED = 'order-needs-cancelled',
  ORDER_NEEDS_READY_TO_GET = 'order-needs-ready-to-get',

  // customer
  ORDER_PAID = 'order-paid',

  ORDER_BILL_FAILED_PRINTING = 'order-bill-failed-printing',
  ORDER_CHEF_ORDER_FAILED_PRINTING = 'order-chef-order-failed-printing',
  ORDER_LABEL_TICKET_FAILED_PRINTING = 'order-label-ticket-failed-printing',

  // gift card
  CARD_ORDER_PAID = 'card-order-paid',
}
