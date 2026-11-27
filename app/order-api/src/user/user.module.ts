import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserInternalController } from './internal/user-internal.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UserProfile } from './user.mapper';
import { MailModule } from 'src/mail/mail.module';
import { UserScheduler } from './user.scheduler';
import { Role } from 'src/role/role.entity';
import { UserUtils } from './user.utils';
import { SharedModule } from 'src/shared/shared.module';
import { UserRequirement } from './user-requirement.entity';
import { TransactionManagerService } from 'src/db/transaction-manager.service';
import { BullModule } from '@nestjs/bullmq';
import { QueueRegisterKey } from 'src/app/app.constants';
import { UserBirthdayProducer } from './user-birthday.producer';
import { USER_BIRTHDAY_QUEUE_PREFIX_ENV } from './user-birthday.constants';
import { ConfigService } from '@nestjs/config';
import { DomainEventsModule } from 'src/domain-events/domain-events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, UserRequirement]),
    MailModule,
    SharedModule,
    DomainEventsModule,
    // Step 6.16 (QD13): the birthday jobs go to the consumer's queue, so this
    // queue takes the consumer's prefix when one is set (the producer is off
    // otherwise, and the queue keeps shared-user's own prefix).
    BullModule.registerQueueAsync({
      name: QueueRegisterKey.USER_BIRTHDAY,
      useFactory: (config: ConfigService) => {
        const prefix = (
          config.get<string>(USER_BIRTHDAY_QUEUE_PREFIX_ENV) ?? ''
        ).trim();
        return prefix ? { prefix } : {};
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: QueueRegisterKey.DISTRIBUTE_LOCK_JOB,
    }),
  ],
  controllers: [UserController, UserInternalController],
  providers: [
    UserService,
    UserProfile,
    UserScheduler,
    UserUtils,
    TransactionManagerService,
    UserBirthdayProducer,
  ],
  exports: [UserService, UserUtils],
})
export class UserModule {}
