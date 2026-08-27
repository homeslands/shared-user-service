import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { User } from 'src/user/user.entity';
import { DataSource } from 'typeorm';
import { CampaignRecipient } from '../../entity/campaign-recipient.entity';
import { Campaign } from '../../entity/campaign.entity';
import { ICampaignStrategy } from '../campaign.strategy';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationLanguageService } from 'src/notification/language/notification-language.service';
import {
  NotificationMessageCode,
  NotificationType,
} from 'src/notification/notification.constants';

/**
 * Birthday campaign whose reward is a gift (giftCampaignTemplate populated,
 * voucherCampaignTemplate null). Unlike the voucher strategy it does NOT mint a
 * Voucher; it only records the CampaignRecipient for the year so the greeting
 * flow (Zalo/SMS/email) can fan out. Reward is delivered/redeemed off-band.
 */
@Injectable()
export class GiftBirthdayCampaignStrategy implements ICampaignStrategy {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: Logger,
    private readonly notificationService: NotificationService,
    private readonly notificationLanguageService: NotificationLanguageService,
  ) {}

  async execute(campaign: Campaign, user: User): Promise<CampaignRecipient> {
    const context = `${GiftBirthdayCampaignStrategy.name}.${this.execute.name}`;
    const currentYear = new Date().getFullYear();

    const { giftCampaignTemplate } = campaign;

    const recipient = await this.dataSource.transaction(async (manager) => {
      // No voucher for gift campaigns — record the recipient only.
      // year = current year -> unique constraint (campaign, user, year) prevents
      // duplicate in same year, same as the voucher birthday strategy.
      const recipientEntity = manager.create(CampaignRecipient, {
        campaign,
        user,
        voucher: null,
        receivedAt: new Date(),
        year: currentYear,
      });
      const saved = await manager.save(recipientEntity);

      this.logger.log(
        `[USER_BIRTHDAY] Gift recipient recorded for user ${user.id} via campaign ${campaign.slug} (year=${currentYear})`,
        context,
      );
      return saved;
    });

    try {
      const { title, body } = this.notificationLanguageService.format(
        NotificationMessageCode.GIFT_BIRTHDAY_RECEIVED,
        {
          giftTitle: giftCampaignTemplate?.title ?? '',
        },
        user.language ?? 'vi',
      );
      await this.notificationService.create({
        receiverId: user.id,
        type: NotificationType.GIFT,
        message: NotificationMessageCode.GIFT_BIRTHDAY_RECEIVED,
        title,
        body,
        metadata: {
          campaignSlug: campaign.slug,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[USER_BIRTHDAY] Failed to send gift notification for user ${user.id}: ${error.message}`,
        context,
      );
    }

    return recipient;
  }
}
