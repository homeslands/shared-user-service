import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './user.entity';
import { Repository } from 'typeorm';
import { Cron, CronExpression, Timeout } from '@nestjs/schedule';
import { Role } from 'src/role/role.entity';
import { RoleEnum } from 'src/role/role.enum';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { UserBirthdayProducer } from './user-birthday.producer';
import { USER_BIRTHDAY_QUEUE_PREFIX_ENV } from './user-birthday.constants';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DistributeLockJobKey, QueueRegisterKey } from 'src/app/app.constants';
import Redlock from 'redlock';

// What one run of the birthday producer did (returned by the manual trigger
// route POST /user/birthday/trigger).
export interface BirthdayProducerRun {
  enabled: boolean;
  birthdayDM?: string;
  users?: number;
  enqueued?: number;
  failed?: boolean;
}

@Injectable()
export class UserScheduler {
  private saltOfRounds: number;
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: Logger,
    private readonly configService: ConfigService,
    private readonly userBirthdayProducer: UserBirthdayProducer,
    @InjectQueue(QueueRegisterKey.DISTRIBUTE_LOCK_JOB)
    private readonly distributeLockJobQueue: Queue,
  ) {
    this.saltOfRounds = this.configService.get<number>('SALT_ROUNDS');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async updateUserRole() {
    const context = `${UserScheduler.name}.${this.updateUserRole.name}`;
    this.logger.log(`Update user role`, context);

    const usersWithoutRole = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .where('role.id IS NULL')
      .getMany();

    this.logger.log(
      `Number of users without role: ${usersWithoutRole.length}`,
      context,
    );

    const role = await this.roleRepository.findOne({
      where: {
        name: RoleEnum.Customer,
      },
    });

    if (!role) {
      this.logger.warn(`Role ${RoleEnum.Customer} not found`);
      return;
    }

    const updatedUsers = usersWithoutRole.map((item) => {
      item.role = role;
      return item;
    });

    this.userRepository.manager.transaction(async (manager) => {
      await manager.save(updatedUsers);
    });
    this.logger.log(`Update user role successfully`, context);
  }

  // Create super user if not exist
  @Timeout(5000)
  async initSuperAdmin() {
    const context = `${UserScheduler.name}.${this.initSuperAdmin.name}`;
    this.logger.log(`Initializing super admin...`, context);

    const hasSuperAdmin = await this.userRepository.exists({
      where: {
        phonenumber: 'root',
      },
    });
    if (hasSuperAdmin) {
      this.logger.warn(`Super admin already existed...`, context);
      return;
    }

    const role = await this.roleRepository.findOne({
      where: {
        name: RoleEnum.SuperAdmin,
      },
    });
    if (!role) {
      this.logger.warn(`Role ${RoleEnum.SuperAdmin} not found`, context);
      return;
    }

    // Create supper admin
    const superAdmin = new User();
    const hashedPass = await bcrypt.hash('root', this.saltOfRounds);
    Object.assign(superAdmin, {
      role,
      phonenumber: 'root',
      firstName: 'Super',
      lastName: 'Admin',
      password: hashedPass,
    } as User);
    try {
      await this.userRepository.save(superAdmin);
      this.logger.log(`Super admin root/root created successfuly`, context);
    } catch (error) {
      this.logger.error(
        `Error when creating super admin: ${error.message}`,
        error.stack,
        context,
      );
    }
  }

  // KHONG con `initDefaultCustomer` (buoc 2.9, chot 03/11/2026). Ban cu nhan
  // dien hang sentinel bang `phonenumber` va sinh `id` NGAU NHIEN, nen hai
  // service dung mot DB dung moi khong the co cung id sentinel - ma 2B2 vua
  // chuyen toan bo phep nhan dien sang `sharedUserId`. Viec "bao dam co hang
  // sentinel" chuyen han sang MIGRATION o buoc 2.10, de moi moi truong di mot
  // duong duy nhat.
  //
  // `shared-user` la NGUON GOC cua hang sentinel: `trend` va `terminal` chi
  // tro vao no. Vi vay bo o day phai di cung lan sua voi hai service kia.
  //
  // `initSuperAdmin` phia tren thi O LAI - no khong thuoc 2B2.

  // Return tomorrow's day-month (DDMM). Birthday greetings are sent one day
  // ahead, so we match users whose birthday is tomorrow. Adding a day to the
  // Date handles month/year rollover (e.g. 31/12 -> 01/01, 28/02 -> 01/03).
  processBirthday(): string {
    const now: Date = new Date();
    now.setDate(now.getDate() + 1);
    const day: string = String(now.getDate()).padStart(2, '0');
    const month: string = String(now.getMonth() + 1).padStart(2, '0');
    return day + month;
  }

  // Step 6.16 (QD13): shared-user owns the date of birth, the consumer owns the
  // campaigns. This scheduler finds the users whose birthday is tomorrow and
  // hands each one to the consumer as a job naming the user (sharedUserId);
  // granting the campaign rewards and greeting (what this method did up to
  // step 6.15, through CampaignService and a consumer of its own) is the
  // consumer's job from now on.
  @Cron(CronExpression.EVERY_DAY_AT_5PM)
  async BirthdayStrategyScheduler(): Promise<BirthdayProducerRun> {
    const context = `${UserScheduler.name}.${this.BirthdayStrategyScheduler.name}`;

    // Off until step 8.1 (USER_BIRTHDAY_QUEUE_PREFIX unset): the consumer does
    // not handle the job yet and still runs its own birthday scheduler. Return
    // before the lock: that scheduler takes the same Redlock key, and a lock
    // held here is a day without greetings on the consumer side
    // (issuses/birthday-scheduler-shared-redlock-key.md).
    if (!this.userBirthdayProducer.isEnabled()) {
      this.logger.log(
        `Birthday producer is off (${USER_BIRTHDAY_QUEUE_PREFIX_ENV} not set), skipping`,
        context,
      );
      return { enabled: false };
    }

    // Distributed lock: with multiple app instances, only one may run the daily
    // birthday producer. The lock is held for its TTL so a second instance
    // starting within the window is skipped (no duplicate jobs).
    const client = await this.distributeLockJobQueue.client;
    const redlock = new Redlock([client]);
    const key = DistributeLockJobKey.SEND_BIRTHDAY_EVERY_DAY_AT_1AM;
    const ttl = 1000 * 60 * 2; // 2 minutes
    const resource = [key];
    let lock: any = null;
    const tomorrowDM = this.processBirthday();
    let enqueued = 0;

    try {
      lock = await redlock.acquire(resource, ttl);
      this.logger.log(
        `Lock success for send birthday every day at 1am`,
        context,
      );

      const users = await this.userRepository.find({
        select: { id: true, slug: true },
        where: { dobDM: tomorrowDM },
      });
      this.logger.log(
        `Found ${users.length} user(s) with birthday tomorrow (${tomorrowDM})`,
        context,
      );

      const year = new Date().getFullYear();
      for (const user of users) {
        await this.userBirthdayProducer.enqueueUser(user, tomorrowDM, year);
        enqueued++;
      }
      return {
        enabled: true,
        birthdayDM: tomorrowDM,
        users: users.length,
        enqueued,
      };
    } catch (error) {
      if (lock) {
        await lock.release();
        this.logger.log(
          `Lock released for send birthday every day at 1am`,
          context,
        );
      }
      this.logger.error(
        `Error when enqueuing birthday jobs`,
        error.stack,
        context,
      );
      return { enabled: true, birthdayDM: tomorrowDM, enqueued, failed: true };
    }
  }
}
