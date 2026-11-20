import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AccumulatedPointService } from './accumulated-point.service';
import { AccumulatedPointTransactionType } from './accumulated-point.constants';

// Step 6.8 (QD11, architect-http.md 1.8 point 6): a reservation always ends.
// The calling services cancel a reservation when someone acts (edit or cancel
// an order); an order that is simply left behind has nobody to act, so the
// wallet releases every open reservation (type RESERVE, status pending) whose
// expiresAt has passed, whatever service holds it. Each release gives the
// points back and writes K:cancel, as cancel-reservation does.
//
// Every minute: the default reservation lives 30 minutes, and the query reads
// the open reservations only (unique index of step 6.4). Running on several
// replicas is safe: each release locks the points row and checks the
// reservation again under that lock.
@Injectable()
export class AccumulatedPointScheduler {
  private running = false;

  constructor(
    private readonly accumulatedPointService: AccumulatedPointService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseExpiredReservations(): Promise<void> {
    const context = `${AccumulatedPointScheduler.name}.${this.releaseExpiredReservations.name}`;
    // A run longer than a minute is not overlapped by the next one.
    if (this.running) return;
    this.running = true;
    try {
      const expiresAt = new Date();
      const released =
        await this.accumulatedPointService.releaseExpiredReservations(
          expiresAt,
        );
      if (released.length > 0) {
        this.logger.log(
          `Released ${released.length} expired ${AccumulatedPointTransactionType.RESERVE} row(s) (expiresAt <= ${expiresAt.toISOString()}): ${released.join(', ')}`,
          context,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error releasing expired reservations: ${error.message}`,
        error.stack,
        context,
      );
    } finally {
      this.running = false;
    }
  }
}
