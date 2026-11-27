import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { TimeoutError, timeout } from 'rxjs';
import { User } from 'src/user/user.entity';

/**
 * Buoc 9.3 - domain event `user.created` (architect-http.md muc 6.2): bao cho
 * `trend` va `terminal` biet co user moi, cho viec KHONG bat buoc (audit log,
 * mail chao mung, campaign). Thay vai tro cua ping PoC (ping con den buoc 10.2).
 *
 * Nest 10 `ClientRMQ` khong co exchange, nen "fan-out" = gui cung mot event
 * (cung `eventId`) vao tung queue cua ben nhan: `trend_queue`, `terminal_queue`.
 *
 * Phat o moi duong tao TAI KHOAN THAT: `POST /auth/register/complete`
 * (`register-otp`), `POST /auth/register` (`register`), `POST /user`
 * (`admin`), `POST /internal/users` (`internal`). KHONG phat khi: nhap tai
 * khoan da co tu truoc (`POST /internal/users/import` - user khong moi), phat
 * hanh the thanh vien hang loat (tai khoan giu cho, so dien thoai gia), tao
 * super admin luc khoi dong.
 *
 * Giao nhan: khong co outbox. Broker chet => event mat (log warn), user van
 * duoc tao. Ben nhan phai chiu duoc ca thieu lan trung (`eventId`).
 */
export const USER_CREATED_EVENT = 'user.created';

export const DOMAIN_EVENT_PUBLISH_TIMEOUT_MS = 5000;

// Loi `connectFailed` cua amqp-connection-manager la `{ err, url }`, khong
// phai `Error` => doc ca `err.message`, khong thi log ra "undefined".
function describePublishError(error: unknown): string {
  const e = error as { message?: string; err?: { message?: string } } | null;
  return e?.message ?? e?.err?.message ?? String(error);
}

export type UserCreatedVia = 'register-otp' | 'register' | 'admin' | 'internal';

export interface UserCreatedEvent {
  eventId: string;
  occurredAt: string;
  sharedUserId: string;
  role: string | null;
  via: UserCreatedVia;
  ownerService: string | null;
}

@Injectable()
export class UserEventPublisher {
  constructor(
    @Inject('TREND_RMQ') private readonly trendClient: ClientProxy,
    @Inject('TERMINAL_RMQ') private readonly terminalClient: ClientProxy,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
  ) {}

  /**
   * Ban-va-quen: tra ve ngay, KHONG BAO GIO nem, khong cho broker - tao user
   * khong duoc cham hay hong vi RabbitMQ. Goi SAU khi user da commit.
   */
  publishUserCreated(user: User, via: UserCreatedVia): void {
    const context = `${UserEventPublisher.name}.${this.publishUserCreated.name}`;
    try {
      const event: UserCreatedEvent = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        sharedUserId: user.id,
        role: user.role?.name ?? null,
        via,
        ownerService: user.ownerService ?? null,
      };
      this.publishTo(this.trendClient, 'trend_queue', event, context);
      this.publishTo(this.terminalClient, 'terminal_queue', event, context);
    } catch (error) {
      this.logger.warn(
        `[${USER_CREATED_EVENT}] could not build/publish the event for user ${user?.id}: ${describePublishError(error)}. The user itself is created.`,
        context,
      );
    }
  }

  private publishTo(
    client: ClientProxy,
    queue: string,
    event: UserCreatedEvent,
    context: string,
  ): void {
    const what = `user ${event.sharedUserId} (event ${event.eventId}) to ${queue}`;
    // `emit` cua Nest 10 la observable NONG: message di ngay ca khi khong ai
    // subscribe. Subscribe chi de biet ket qua va bat loi.
    client
      .emit(USER_CREATED_EVENT, event)
      .pipe(timeout(DOMAIN_EVENT_PUBLISH_TIMEOUT_MS))
      .subscribe({
        complete: () =>
          this.logger.log(`[${USER_CREATED_EVENT}] published ${what}`, context),
        error: (error: unknown) => {
          if (error instanceof TimeoutError) {
            // Broker rot SAU khi da noi: amqp-connection-manager giu message
            // trong bo dem va gui khi noi lai. KHONG dong client (dong la vut
            // bo dem).
            this.logger.warn(
              `[${USER_CREATED_EVENT}] publish of ${what} not confirmed within ${DOMAIN_EVENT_PUBLISH_TIMEOUT_MS} ms - RabbitMQ unreachable, the event may arrive late or be lost.`,
              context,
            );
            return;
          }
          // Loi that, vd broker chet ngay lan noi DAU TIEN: `ClientRMQ` cua
          // Nest 10 giu loi do trong `connection$` mai mai => moi lan emit sau
          // deu hong toi khi khoi dong lai. Dong client de lan sau noi lai.
          try {
            client.close();
          } catch {
            // da dong / chua tung noi - khong co gi de lam
          }
          this.logger.warn(
            `[${USER_CREATED_EVENT}] publish of ${what} failed: ${describePublishError(error)} - event dropped.`,
            context,
          );
        },
      });
  }
}
