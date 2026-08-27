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
import { CampaignService } from 'src/campaign/campaign.service';
import { CampaignType } from 'src/campaign/campaign.constants';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DistributeLockJobKey, QueueRegisterKey } from 'src/app/app.constants';
import Redlock from 'redlock';

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
    private readonly campaignService: CampaignService,
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

  @Timeout(5000)
  async initDefaultCustomer() {
    const context = `${UserScheduler.name}.${this.initDefaultCustomer.name}`;
    this.logger.log(`Initializing default customer...`, context);

    const hasDefaultCustomer = await this.userRepository.exists({
      where: {
        phonenumber: 'default-customer',
      },
    });
    if (hasDefaultCustomer) {
      this.logger.warn(`Default customer already existed...`, context);
      return;
    }

    const role = await this.roleRepository.findOne({
      where: {
        name: RoleEnum.Customer,
      },
    });
    if (!role) {
      this.logger.warn(`Role ${RoleEnum.Customer} not found`, context);
      return;
    }

    // Create default customer
    const defaultCustomer = new User();
    const hashedPass = await bcrypt.hash('default-customer', this.saltOfRounds);
    Object.assign(defaultCustomer, {
      role,
      phonenumber: 'default-customer',
      firstName: 'Default',
      lastName: 'Customer',
      password: hashedPass,
    } as User);
    try {
      await this.userRepository.save(defaultCustomer);
      this.logger.log(`Default customer created successfuly`, context);
    } catch (error) {
      this.logger.error(
        `Error when creating default customer: ${error.message}`,
        error.stack,
        context,
      );
    }
  }
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

  @Cron(CronExpression.EVERY_DAY_AT_5PM)
  async BirthdayStrategyScheduler() {
    const context = `${UserScheduler.name}.${this.BirthdayStrategyScheduler.name}`;

    // Distributed lock: with multiple app instances, only one may run the daily
    // birthday sender. The lock is held for its TTL so a second instance
    // starting within the window is skipped (no duplicate greeting jobs).
    const client = await this.distributeLockJobQueue.client;
    const redlock = new Redlock([client]);
    const key = DistributeLockJobKey.SEND_BIRTHDAY_EVERY_DAY_AT_1AM;
    const ttl = 1000 * 60 * 2; // 2 minutes
    const resource = [key];
    let lock: any = null;

    try {
      lock = await redlock.acquire(resource, ttl);
      this.logger.log(
        `Lock success for send birthday every day at 1am`,
        context,
      );

      // Only run the birthday sender when a birthday campaign is available.
      // Each campaign's reward type decides which channels are used:
      // voucher -> SMS + Email, gift -> SMS + Zalo + Email.
      const campaigns =
        await this.campaignService.getAvailableBirthdayCampaigns();
      if (campaigns.length === 0) {
        this.logger.log(
          `No available ${CampaignType.USER_BIRTHDAY} campaign, skipping birthday sender`,
          context,
        );
        return;
      }

      const tomorrowDM = this.processBirthday();
      const users = await this.userRepository.find({
        where: {
          dobDM: tomorrowDM,
        },
      });

      if (users.length === 0) {
        this.logger.log(
          `Found 0 user that has birthday tomorrow (${tomorrowDM})`,
          context,
        );
        return;
      }

      this.logger.log(
        `Found ${users.length} user(s) with birthday tomorrow (${tomorrowDM}). Enqueuing to Redis...`,
        context,
      );

      // Write each birthday user into Redis; the UserBirthdayProducer fans each
      // user out into per-channel jobs (based on the reward type) that the
      // UserBirthdayConsumer processes independently and at the same time.
      const year = new Date().getFullYear();
      for (const user of users) {
        // Cấp phần thưởng cho mọi campaign USER_BIRTHDAY đang mở (voucher hoặc
        // gift) — tạo CampaignRecipient nếu chưa có — trước khi gửi lời chúc.
        // Thay cho luồng CampaignScheduler.handleBirthdayCampaigns (1AM) đã ẩn:
        // gộp grant + greet vào một luồng duy nhất, chạy trước sinh nhật 1 ngày.
        await this.campaignService.triggerForUser(
          user,
          CampaignType.USER_BIRTHDAY,
        );

        for (const campaign of campaigns) {
          // Only greet valid recipients (Flow 1 granted the reward this year),
          // and at most once per year. Claim the greeting here — before fanning
          // out to channels — so a re-run enqueues nothing (neither Zalo/SMS nor
          // email), instead of gating each channel separately.
          const recipient = await this.campaignService.findBirthdayRecipient(
            campaign.id,
            user.id,
            year,
          );
          if (!recipient) {
            this.logger.warn(
              `User ${user.slug} is not a valid birthday recipient for campaign ${campaign.slug} in ${year}, skip`,
              context,
            );
            continue;
          }
          const claimed = await this.campaignService.claimBirthdayGreeting(
            recipient.id,
          );
          if (!claimed) {
            this.logger.warn(
              `User ${user.slug} already greeted for campaign ${campaign.slug} in ${year}, skip`,
              context,
            );
            continue;
          }
          await this.userBirthdayProducer.enqueueUser(user, campaign);
        }
      }

      this.logger.log(
        `Enqueued ${users.length} birthday greeting job(s)`,
        context,
      );
    } catch (error) {
      if (lock) {
        await lock.release();
        this.logger.log(
          `Lock released for send birthday every day at 1am`,
          context,
        );
      }
      this.logger.error(
        `Error when sending birthday greetings`,
        error.stack,
        context,
      );
      return;
    }
  }
}
