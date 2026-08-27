import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { User } from 'src/user/user.entity';
import {
  VoucherCustomerType,
  VoucherType,
  VoucherValueType,
} from 'src/voucher/voucher.constant';
import { Voucher } from 'src/voucher/entity/voucher.entity';
import { VoucherPaymentMethod } from 'src/voucher/entity/voucher-payment-method.entity';
import { VoucherProduct } from 'src/voucher-product/voucher-product.entity';
import { Product } from 'src/product/product.entity';
import { DataSource, In } from 'typeorm';
import { SharedPointTransactionService } from 'src/shared/services/shared-point-transaction.service';
import { CreatePointTransactionDto } from 'src/gift-card-modules/point-transaction/dto/create-point-transaction.dto';
import {
  PointTransactionObjectTypeEnum,
  PointTransactionTypeEnum,
} from 'src/gift-card-modules/point-transaction/entities/point-transaction.enum';
import { SharedBalanceService } from 'src/shared/services/shared-balance.service';
import { CampaignRecipient } from '../../entity/campaign-recipient.entity';
import { Campaign } from '../../entity/campaign.entity';
import { CoinCampaignTemplate } from '../../entity/coin-campaign-template.entity';
import { CampaignStatus } from '../../campaign.constants';
import { CampaignException } from '../../campaign.exception';
import { CampaignValidation } from '../../campaign.validation';
import { ICampaignStrategy } from '../campaign.strategy';
import { RoleEnum } from 'src/role/role.enum';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationLanguageService } from 'src/notification/language/notification-language.service';
import {
  NotificationMessageCode,
  NotificationType,
} from 'src/notification/notification.constants';

@Injectable()
export class NewUserCampaignStrategy implements ICampaignStrategy {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: Logger,
    private readonly sharedPointTransactionService: SharedPointTransactionService,
    private readonly sharedBalanceService: SharedBalanceService,
    private readonly notificationService: NotificationService,
    private readonly notificationLanguageService: NotificationLanguageService,
  ) {}

  async execute(campaign: Campaign, user: User): Promise<CampaignRecipient> {
    // Reward type is implied by which template the campaign carries.
    if (campaign.coinCampaignTemplate) {
      return this.executeCoinGift(campaign, user);
    }
    return this.executeVoucherGift(campaign, user);
  }

  private async executeVoucherGift(
    campaign: Campaign,
    user: User,
  ): Promise<CampaignRecipient> {
    const context = `${NewUserCampaignStrategy.name}.${this.executeVoucherGift.name}`;

    let createdVoucher: Voucher;

    const recipient = await this.dataSource.transaction(async (manager) => {
      const { voucherCampaignTemplate, voucherGroup } = campaign;

      const code = `${campaign.slug}-${user.id.slice(0, 8)}-${Date.now()}`;

      const startDate = campaign.startDate;
      const issuedAt = new Date();
      const endDate =
        campaign.endDate ??
        new Date(
          issuedAt.getTime() +
            voucherCampaignTemplate.duration * 24 * 60 * 60 * 1000,
        );

      const valueType =
        voucherCampaignTemplate.type === VoucherType.PERCENT_ORDER
          ? VoucherValueType.PERCENTAGE
          : VoucherValueType.AMOUNT;

      const voucher = manager.create(Voucher, {
        code,
        title: voucherCampaignTemplate.title,
        description: voucherCampaignTemplate.description,
        value: voucherCampaignTemplate.value,
        valueType,
        type: voucherCampaignTemplate.type,
        maxUsage: voucherCampaignTemplate.maxUsage,
        remainingUsage: voucherCampaignTemplate.maxUsage,
        minOrderValue: voucherCampaignTemplate.minOrderValue,
        applicabilityRule: voucherCampaignTemplate.applicabilityRule,
        usageFrequencyUnit: voucherCampaignTemplate.usageFrequencyUnit,
        usageFrequencyValue: voucherCampaignTemplate.usageFrequencyValue,
        maxItems: voucherCampaignTemplate.maxItems,
        startDate,
        endDate,
        isActive: true,
        isPrivate: false,
        isVerificationIdentity: true,
        numberOfUsagePerUser: 1,
        customerType: VoucherCustomerType.PERSON,
        assignedUser: user,
        voucherGroup,
      });
      await manager.save(voucher);
      createdVoucher = voucher;

      if (voucherCampaignTemplate.paymentMethods?.length) {
        const voucherPaymentMethods =
          voucherCampaignTemplate.paymentMethods.map((pm) =>
            manager.create(VoucherPaymentMethod, {
              voucher,
              paymentMethod: pm,
            }),
          );
        await manager.save(VoucherPaymentMethod, voucherPaymentMethods);
      }

      if (voucherCampaignTemplate.productSlugs?.length) {
        const products = await manager.find(Product, {
          where: { slug: In(voucherCampaignTemplate.productSlugs) },
        });
        const voucherProducts = products.map((product) =>
          manager.create(VoucherProduct, { voucher, product }),
        );
        await manager.save(VoucherProduct, voucherProducts);
      }

      // year = null -> one-time campaign, will never repeat
      const recipientEntity = manager.create(CampaignRecipient, {
        campaign,
        user,
        voucher,
        receivedAt: new Date(),
        year: null,
      });
      const saved = await manager.save(recipientEntity);

      this.logger.log(
        `[NEW_USER] Voucher ${voucher.code} created for user ${user.id} via campaign ${campaign.slug}`,
        context,
      );
      return saved;
    });

    try {
      const { title, body } = this.notificationLanguageService.format(
        NotificationMessageCode.VOUCHER_NEW_USER_RECEIVED,
        {
          voucherTitle: createdVoucher.title,
          voucherCode: createdVoucher.code,
        },
        user.language ?? 'vi',
      );
      await this.notificationService.create({
        receiverId: user.id,
        type: NotificationType.VOUCHER,
        message: NotificationMessageCode.VOUCHER_NEW_USER_RECEIVED,
        title,
        body,
        metadata: {
          voucherCode: createdVoucher.code,
          campaignSlug: campaign.slug,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[NEW_USER] Failed to send notification for user ${user.id}: ${error.message}`,
        context,
      );
    }

    return recipient;
  }

  private async executeCoinGift(
    campaign: Campaign,
    user: User,
  ): Promise<CampaignRecipient> {
    const context = `${NewUserCampaignStrategy.name}.${this.executeCoinGift.name}`;

    let grantedCoin = 0;
    let budgetExhausted = false;
    let closedAfterGrant = false;
    let remainingAtExhaustion = 0;
    let coinPerUserNeeded = 0;

    // 1. Reserve the coins and record the recipient atomically. The template
    // row is locked so concurrent registrations cannot overspend the budget.
    const recipient = await this.dataSource.transaction(async (manager) => {
      const template = await manager.findOne(CoinCampaignTemplate, {
        where: { id: campaign.coinCampaignTemplate.id },
        lock: { mode: 'pessimistic_write' },
      });

      const coinPerUser = Number(template.coinPerUser);

      // remainingCoin null = unlimited budget; otherwise spend from the pool.
      if (template.remainingCoin != null) {
        if (Number(template.remainingCoin) < coinPerUser) {
          budgetExhausted = true;
          remainingAtExhaustion = Number(template.remainingCoin);
          coinPerUserNeeded = coinPerUser;
          return null;
        }

        template.remainingCoin = Number(template.remainingCoin) - coinPerUser;
        await manager.save(template);

        // Remaining pool can no longer cover another grant -> stop the
        // campaign so it no longer triggers. It can be reopened by raising
        // totalCoinLimit (which refills remainingCoin) via campaign update.
        if (template.remainingCoin < coinPerUser) {
          closedAfterGrant = true;
          remainingAtExhaustion = template.remainingCoin;
          coinPerUserNeeded = coinPerUser;
          await manager.update(Campaign, campaign.id, {
            status: CampaignStatus.CLOSED,
          });
          this.logger.log(
            `[NEW_USER][COIN] Coin budget of campaign ${campaign.slug} is now exhausted (${template.remainingCoin} < ${coinPerUser}), campaign closed`,
            context,
          );
        }
      }
      grantedCoin = coinPerUser;

      // year = null -> one-time campaign, will never repeat
      const recipientEntity = manager.create(CampaignRecipient, {
        campaign,
        user,
        voucher: null,
        coinAmount: coinPerUser,
        receivedAt: new Date(),
        year: null,
      });
      return manager.save(recipientEntity);
    });

    if (budgetExhausted) {
      // Out of coins before this user could be served: stop the campaign and
      // let the admins know; the registering user gets no coins.
      await this.dataSource
        .getRepository(Campaign)
        .update(campaign.id, { status: CampaignStatus.CLOSED });
      this.logger.warn(
        `[NEW_USER][COIN] Coin budget of campaign ${campaign.slug} exhausted, campaign closed`,
        context,
      );
      await this.notifyAdminsBudgetExhausted(
        campaign,
        remainingAtExhaustion,
        coinPerUserNeeded,
      );
      throw new CampaignException(
        CampaignValidation.CAMPAIGN_COIN_BUDGET_EXHAUSTED,
      );
    }

    if (closedAfterGrant) {
      // This grant succeeded but drained the pool below one more grant; the
      // campaign was closed inside the transaction — let the admins know.
      await this.notifyAdminsBudgetExhausted(
        campaign,
        remainingAtExhaustion,
        coinPerUserNeeded,
      );
    }

    // 2. Credit the user's balance, then record the point transaction (same
    // order as the gift-card redeem flow).
    await this.sharedBalanceService.calcBalance({
      userSlug: user.slug,
      points: grantedCoin,
      type: PointTransactionTypeEnum.IN,
    });

    const currentBalance = await this.sharedBalanceService.findOneByField({
      userSlug: user.slug,
      slug: null,
    });

    await this.sharedPointTransactionService.create({
      type: PointTransactionTypeEnum.IN,
      desc: `Tặng ${grantedCoin.toLocaleString()} xu chào mừng thành viên mới từ chiến dịch ${campaign.name}`,
      objectType: PointTransactionObjectTypeEnum.CAMPAIGN,
      objectSlug: campaign.slug,
      points: grantedCoin,
      userSlug: user.slug,
      balance: currentBalance.points,
    } as CreatePointTransactionDto);

    this.logger.log(
      `[NEW_USER][COIN] ${grantedCoin} coins credited to user ${user.id} via campaign ${campaign.slug}`,
      context,
    );

    // 3. Send notification (best-effort, outside any transaction, try/catch).
    try {
      const { title, body } = this.notificationLanguageService.format(
        NotificationMessageCode.COIN_NEW_USER_RECEIVED,
        { points: grantedCoin.toLocaleString() },
        user.language ?? 'vi',
      );
      await this.notificationService.create({
        receiverId: user.id,
        type: NotificationType.COIN,
        message: NotificationMessageCode.COIN_NEW_USER_RECEIVED,
        title,
        body,
        metadata: {
          points: grantedCoin,
          campaignSlug: campaign.slug,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[NEW_USER][COIN] Failed to send notification for user ${user.id}: ${error.message}`,
        context,
      );
    }

    return recipient;
  }

  /**
   * Best-effort admin alert that the coin campaign was closed because its
   * remaining budget can no longer cover one grant. Failures are only logged —
   * the caller still throws CAMPAIGN_COIN_BUDGET_EXHAUSTED for the user.
   */
  private async notifyAdminsBudgetExhausted(
    campaign: Campaign,
    remainingCoin: number,
    coinPerUser: number,
  ): Promise<void> {
    const context = `${NewUserCampaignStrategy.name}.${this.notifyAdminsBudgetExhausted.name}`;

    try {
      const admins = await this.dataSource.getRepository(User).find({
        where: { role: { name: In([RoleEnum.Admin, RoleEnum.SuperAdmin]) } },
      });

      for (const admin of admins) {
        const { title, body } = this.notificationLanguageService.format(
          NotificationMessageCode.COIN_CAMPAIGN_BUDGET_EXHAUSTED,
          {
            campaignName: campaign.name,
            remainingCoin: remainingCoin.toLocaleString(),
            coinPerUser: coinPerUser.toLocaleString(),
          },
          admin.language ?? 'vi',
        );
        await this.notificationService.create({
          receiverId: admin.id,
          type: NotificationType.COIN,
          message: NotificationMessageCode.COIN_CAMPAIGN_BUDGET_EXHAUSTED,
          title,
          body,
          metadata: {
            campaignSlug: campaign.slug,
            remainingCoin,
            coinPerUser,
          },
        });
      }
    } catch (error) {
      this.logger.warn(
        `[NEW_USER][COIN] Failed to notify admins about exhausted budget of campaign ${campaign.slug}: ${error.message}`,
        context,
      );
    }
  }
}
