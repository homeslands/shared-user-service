import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { QueueRegisterKey } from 'src/app/app.constants';
import { User } from './user.entity';
import {
  USER_BIRTHDAY_QUEUE_PREFIX_ENV,
  USER_BIRTHDAY_TRIGGERED_JOB,
  UserBirthdayTriggeredJobData,
} from './user-birthday.constants';

// Producer half of the birthday flow (QD13, step 6.16). The queue is
// registered under the consumer's prefix (UserModule); this class only decides
// whether to write and what.
@Injectable()
export class UserBirthdayProducer {
  constructor(
    @InjectQueue(QueueRegisterKey.USER_BIRTHDAY)
    private readonly birthdayQueue: Queue,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {}

  // Prefix of the consuming service, '' when the producer is off.
  consumerPrefix(): string {
    return (
      this.configService.get<string>(USER_BIRTHDAY_QUEUE_PREFIX_ENV) ?? ''
    ).trim();
  }

  isEnabled(): boolean {
    return this.consumerPrefix() !== '';
  }

  /**
   * Tell the consumer that a user has a birthday on birthdayDM. One job per
   * user and year: a second run of the same day (the manual trigger route)
   * does not add a second job while the first one waits. The consumer's own
   * once-per-year greeting check stays the real guard.
   */
  async enqueueUser(
    user: Pick<User, 'id' | 'slug'>,
    birthdayDM: string,
    year: number,
  ): Promise<void> {
    const context = `${UserBirthdayProducer.name}.${this.enqueueUser.name}`;
    const data: UserBirthdayTriggeredJobData = {
      sharedUserId: user.id,
      birthdayDM,
      year,
    };
    await this.birthdayQueue.add(USER_BIRTHDAY_TRIGGERED_JOB, data, {
      jobId: `${USER_BIRTHDAY_TRIGGERED_JOB}:${year}:${user.id}`,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    this.logger.log(
      `Enqueued ${USER_BIRTHDAY_TRIGGERED_JOB} for user ${user.slug} on ${this.birthdayQueue.opts.prefix}:${this.birthdayQueue.name}`,
      context,
    );
  }
}
