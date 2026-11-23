import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

/**
 * Buoc 9.3 - nghe `order.completed` cua `trend` / `terminal` (architect-http.md
 * muc 6.2), queue `shared_user_queue`. Hom nay chi ghi log phan tich.
 *
 * KHONG cong / tru gi o day (muc 6.3): diem va xu cua don da chot bang HTTP
 * noi bo kem khoa idempotent TRUOC khi event duoc phat. Lam lai o day la cong
 * hai lan.
 */
export const ORDER_COMPLETED_EVENT = 'order.completed';

export interface OrderCompletedEvent {
  eventId: string;
  occurredAt: string;
  service: string;
  orderSlug: string;
  referenceNumber: number | null;
  branchSlug: string | null;
  sharedUserId: string | null;
  paymentMethod: string | null;
  subtotal: number;
}

@Controller()
export class OrderCompletedConsumer {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
  ) {}

  @EventPattern(ORDER_COMPLETED_EVENT)
  handleOrderCompleted(@Payload() event: Partial<OrderCompletedEvent>): void {
    const context = `${OrderCompletedConsumer.name}.${this.handleOrderCompleted.name}`;
    this.logger.log(
      `[${ORDER_COMPLETED_EVENT}] received ${event?.service} order ${event?.orderSlug} #${event?.referenceNumber} (branch ${event?.branchSlug}, sharedUserId ${event?.sharedUserId}, ${event?.paymentMethod}, subtotal ${event?.subtotal}, event ${event?.eventId})`,
      context,
    );
  }
}
