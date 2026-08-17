import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectMapper } from '@automapper/nestjs';
import { Mapper } from '@automapper/core';
import {
  FindManyOptions,
  In,
  IsNull,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { VoucherGroup } from 'src/voucher-group/voucher-group.entity';
import { Product } from 'src/product/product.entity';
import { User } from 'src/user/user.entity';
import { AppPaginatedResponseDto } from 'src/app/app.dto';
import { CampaignRecipient } from './entity/campaign-recipient.entity';
import { Campaign } from './entity/campaign.entity';
import { VoucherCampaignTemplate } from './entity/voucher-campaign-template.entity';
import { GiftCampaignTemplate } from './entity/gift-campaign-template.entity';
import { CampaignException } from './campaign.exception';
import {
  CampaignType,
  CampaignRewardType,
  CampaignStatus,
  AvailableBirthdayCampaign,
  BirthdayVoucherInfo,
} from './campaign.constants';
import { CampaignValidation } from './campaign.validation';
import {
  CampaignKeyResponseDto,
  CampaignResponseDto,
  CreateCampaignRequestDto,
  GetAllCampaignQueryRequestDto,
  UpdateCampaignRequestDto,
} from './campaign.dto';
import { ICampaignStrategy } from './strategy/campaign.strategy';
import { NewUserCampaignStrategy } from './strategy/new-user-campaign/new-user-campaign.strategy';
import { UserBirthdayCampaignStrategy } from './strategy/user-birthday-campaign/user-birthday-campaign.strategy';
import { GiftBirthdayCampaignStrategy } from './strategy/gift-birthday-campaign/gift-birthday-campaign.strategy';
import { RoleEnum } from 'src/role/role.enum';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(CampaignRecipient)
    private readonly recipientRepository: Repository<CampaignRecipient>,
    @InjectRepository(VoucherGroup)
    private readonly voucherGroupRepository: Repository<VoucherGroup>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(VoucherCampaignTemplate)
    private readonly voucherCampaignTemplateRepository: Repository<VoucherCampaignTemplate>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly newUserCampaignStrategy: NewUserCampaignStrategy,
    private readonly userBirthdayCampaignStrategy: UserBirthdayCampaignStrategy,
    private readonly giftBirthdayCampaignStrategy: GiftBirthdayCampaignStrategy,
    @InjectMapper() private readonly mapper: Mapper,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: Logger,
  ) {}

  getAllCampaignKeys(): CampaignKeyResponseDto[] {
    const context = `${CampaignService.name}.${this.getAllCampaignKeys.name}`;
    this.logger.log(`Get all campaign keys`, context);
    return Object.values(CampaignType).map((key) => ({ key }));
  }

  async create(dto: CreateCampaignRequestDto): Promise<CampaignResponseDto> {
    const context = `${CampaignService.name}.${this.create.name}`;

    this.validateCampaignTemplate(dto);

    // Only voucher campaigns issue vouchers into a group; gift campaigns don't
    // use one, so skip the lookup and leave campaign.voucherGroup null for them.
    let voucherGroup: VoucherGroup | null = null;
    if (dto.campaignType !== CampaignRewardType.GIFT) {
      // A voucher group is mandatory here; guard the empty slug too, otherwise
      // findOne({ slug: undefined }) would silently match an arbitrary group.
      if (!dto.voucherGroupSlug) {
        throw new CampaignException(
          CampaignValidation.CAMPAIGN_VOUCHER_GROUP_REQUIRED,
        );
      }
      voucherGroup = await this.voucherGroupRepository.findOne({
        where: { slug: dto.voucherGroupSlug },
      });
      if (!voucherGroup) {
        throw new CampaignException(
          CampaignValidation.CAMPAIGN_VOUCHER_GROUP_NOT_FOUND,
        );
      }
    }

    const now = new Date();

    if (dto.startDate <= now) {
      throw new CampaignException(
        CampaignValidation.CAMPAIGN_INVALID_STATUS_TRANSITION,
      );
    }

    if (dto.endDate && dto.endDate <= dto.startDate) {
      throw new CampaignException(
        CampaignValidation.CAMPAIGN_INVALID_DATE_RANGE,
      );
    }

    if (dto.type === CampaignType.USER_BIRTHDAY) {
      await this.assertNoOverlappingBirthdayCampaign(dto.startDate, dto.endDate);
    }

    const campaign = this.mapper.map(dto, CreateCampaignRequestDto, Campaign);
    if (voucherGroup) {
      campaign.voucherGroup = voucherGroup;
    }
    campaign.status = CampaignStatus.SCHEDULED;

    if (dto.voucherCampaignTemplate) {
      if (dto.endDate) {
        dto.voucherCampaignTemplate.duration = null;
      } else if (!dto.voucherCampaignTemplate.duration) {
        throw new CampaignException(
          CampaignValidation.CAMPAIGN_DURATION_REQUIRED_WITHOUT_END_DATE,
        );
      }

      if (dto.voucherCampaignTemplate.productSlugs?.length) {
        await this.validateProductSlugs(
          dto.voucherCampaignTemplate.productSlugs,
        );
      }
      const template = new VoucherCampaignTemplate();
      Object.assign(template, dto.voucherCampaignTemplate);
      campaign.voucherCampaignTemplate = template;
    }

    if (dto.giftCampaignTemplate) {
      if (dto.endDate) {
        dto.giftCampaignTemplate.duration = null;
      } else if (!dto.giftCampaignTemplate.duration) {
        throw new CampaignException(
          CampaignValidation.CAMPAIGN_DURATION_REQUIRED_WITHOUT_END_DATE,
        );
      }

      const template = new GiftCampaignTemplate();
      Object.assign(template, dto.giftCampaignTemplate);
      campaign.giftCampaignTemplate = template;
    }

    const saved = await this.campaignRepository.save(campaign);
    this.logger.log(`Campaign created: ${saved.slug}`, context);

    const result = await this.campaignRepository.findOne({
      where: { id: saved.id },
      relations: {
        voucherGroup: true,
        voucherCampaignTemplate: true,
        giftCampaignTemplate: true,
      },
    });
    return this.mapper.map(result, Campaign, CampaignResponseDto);
  }

  async findAll(
    query: GetAllCampaignQueryRequestDto,
  ): Promise<AppPaginatedResponseDto<CampaignResponseDto>> {
    const findManyOptions: FindManyOptions<Campaign> = {
      where: {
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      relations: {
        voucherGroup: true,
        voucherCampaignTemplate: true,
        giftCampaignTemplate: true,
      },
      order: { createdAt: 'DESC' },
    };

    if (query.hasPaging) {
      Object.assign(findManyOptions, {
        skip: (query.page - 1) * query.size,
        take: query.size,
      });
    }

    const [campaigns, total] =
      await this.campaignRepository.findAndCount(findManyOptions);
    const totalPages = Math.ceil(total / query.size);

    return {
      hasNext: query.page < totalPages,
      hasPrevios: query.page > 1,
      items: this.mapper.mapArray(campaigns, Campaign, CampaignResponseDto),
      total,
      page: query.hasPaging ? query.page : 1,
      pageSize: query.hasPaging ? query.size : total,
      totalPages,
    } as AppPaginatedResponseDto<CampaignResponseDto>;
  }

  async findOne(slug: string): Promise<CampaignResponseDto> {
    const campaign = await this.campaignRepository.findOne({
      where: { slug },
      relations: {
        voucherGroup: true,
        voucherCampaignTemplate: true,
        giftCampaignTemplate: true,
      },
    });
    if (!campaign) {
      throw new CampaignException(CampaignValidation.CAMPAIGN_NOT_FOUND);
    }
    return this.mapper.map(campaign, Campaign, CampaignResponseDto);
  }

  async update(
    slug: string,
    dto: UpdateCampaignRequestDto,
  ): Promise<CampaignResponseDto> {
    const context = `${CampaignService.name}.${this.update.name}`;

    const campaign = await this.campaignRepository.findOne({
      where: { slug },
      relations: {
        voucherGroup: true,
        voucherCampaignTemplate: true,
        giftCampaignTemplate: true,
      },
    });
    if (!campaign) {
      throw new CampaignException(CampaignValidation.CAMPAIGN_NOT_FOUND);
    }

    const now = new Date();
    const effectiveStartDate = dto.startDate ?? campaign.startDate;
    const effectiveEndDate =
      dto.endDate !== undefined ? dto.endDate : campaign.endDate;

    if (effectiveEndDate && effectiveEndDate <= effectiveStartDate) {
      throw new CampaignException(
        CampaignValidation.CAMPAIGN_INVALID_DATE_RANGE,
      );
    }

    if (
      campaign.type === CampaignType.USER_BIRTHDAY &&
      (dto.startDate !== undefined || dto.endDate !== undefined)
    ) {
      await this.assertNoOverlappingBirthdayCampaign(
        effectiveStartDate,
        effectiveEndDate,
        campaign.id,
      );
    }

    if (dto.status === CampaignStatus.OPENING && effectiveStartDate > now) {
      throw new CampaignException(
        CampaignValidation.CAMPAIGN_INVALID_STATUS_TRANSITION,
      );
    }

    if (dto.status === CampaignStatus.SCHEDULED && effectiveStartDate <= now) {
      throw new CampaignException(
        CampaignValidation.CAMPAIGN_INVALID_STATUS_TRANSITION,
      );
    }

    if (dto.voucherGroupSlug) {
      const voucherGroup = await this.voucherGroupRepository.findOne({
        where: { slug: dto.voucherGroupSlug },
      });
      if (!voucherGroup) {
        throw new CampaignException(
          CampaignValidation.CAMPAIGN_VOUCHER_GROUP_NOT_FOUND,
        );
      }
      campaign.voucherGroup = voucherGroup;
    }

    if (dto.voucherCampaignTemplate !== undefined) {
      if (effectiveEndDate) {
        dto.voucherCampaignTemplate.duration = null;
      } else {
        const effectiveDuration =
          dto.voucherCampaignTemplate.duration ??
          campaign.voucherCampaignTemplate?.duration;
        if (!effectiveDuration) {
          throw new CampaignException(
            CampaignValidation.CAMPAIGN_DURATION_REQUIRED_WITHOUT_END_DATE,
          );
        }
      }

      if (dto.voucherCampaignTemplate.productSlugs?.length) {
        await this.validateProductSlugs(
          dto.voucherCampaignTemplate.productSlugs,
        );
      }
      if (campaign.voucherCampaignTemplate) {
        Object.assign(
          campaign.voucherCampaignTemplate,
          dto.voucherCampaignTemplate,
        );
      } else {
        const template = new VoucherCampaignTemplate();
        Object.assign(template, dto.voucherCampaignTemplate);
        campaign.voucherCampaignTemplate = template;
      }
    } else if (dto.endDate !== undefined && campaign.voucherCampaignTemplate) {
      if (effectiveEndDate) {
        campaign.voucherCampaignTemplate.duration = null;
      } else if (!campaign.voucherCampaignTemplate.duration) {
        throw new CampaignException(
          CampaignValidation.CAMPAIGN_DURATION_REQUIRED_WITHOUT_END_DATE,
        );
      }
    }

    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.status !== undefined) campaign.status = dto.status;
    if (dto.recipientLimit !== undefined)
      campaign.recipientLimit = dto.recipientLimit;
    if (dto.startDate !== undefined) campaign.startDate = dto.startDate;
    if (dto.endDate !== undefined) campaign.endDate = dto.endDate;

    const saved = await this.campaignRepository.save(campaign);
    this.logger.log(`Campaign updated: ${saved.slug}`, context);

    const result = await this.campaignRepository.findOne({
      where: { id: saved.id },
      relations: {
        voucherGroup: true,
        voucherCampaignTemplate: true,
        giftCampaignTemplate: true,
      },
    });
    return this.mapper.map(result, Campaign, CampaignResponseDto);
  }

  async delete(slug: string): Promise<void> {
    const context = `${CampaignService.name}.${this.delete.name}`;

    const campaign = await this.campaignRepository.findOne({
      where: { slug },
      relations: { voucherCampaignTemplate: true },
    });
    if (!campaign) {
      throw new CampaignException(CampaignValidation.CAMPAIGN_NOT_FOUND);
    }

    const recipientCount = await this.recipientRepository.count({
      where: { campaign: { id: campaign.id } },
    });
    if (recipientCount > 0) {
      throw new CampaignException(CampaignValidation.CAMPAIGN_HAS_VOUCHERS);
    }

    if (campaign.voucherCampaignTemplate) {
      await this.voucherCampaignTemplateRepository.delete(
        campaign.voucherCampaignTemplate.id,
      );
    }

    await this.campaignRepository.delete(campaign.id);
    this.logger.log(`Campaign deleted: ${slug}`, context);
  }

  /**
   * Whether at least one campaign of the given type is currently available,
   * i.e. status OPENING, already started, and not yet ended.
   */
  async isCampaignAvailable(campaignType: CampaignType): Promise<boolean> {
    const context = `${CampaignService.name}.${this.isCampaignAvailable.name}`;
    const now = new Date();

    const campaigns = await this.campaignRepository.find({
      where: {
        type: campaignType,
        status: CampaignStatus.OPENING,
        startDate: LessThanOrEqual(now),
      },
      select: { id: true, endDate: true },
    });

    const available = campaigns.some((c) => !c.endDate || c.endDate >= now);
    this.logger.log(
      `Campaign type ${campaignType} available: ${available}`,
      context,
    );
    return available;
  }

  /**
   * Currently-available USER_BIRTHDAY campaigns, each with its reward type
   * (derived from which template it carries). Used by the greeting sender to
   * route channels and to look up the campaign's vouchers.
   */
  async getAvailableBirthdayCampaigns(): Promise<AvailableBirthdayCampaign[]> {
    const context = `${CampaignService.name}.${this.getAvailableBirthdayCampaigns.name}`;
    const now = new Date();

    const campaigns = await this.campaignRepository.find({
      where: {
        type: CampaignType.USER_BIRTHDAY,
        status: CampaignStatus.OPENING,
        startDate: LessThanOrEqual(now),
      },
      relations: {
        voucherCampaignTemplate: true,
        giftCampaignTemplate: true,
      },
    });

    const result: AvailableBirthdayCampaign[] = [];
    for (const campaign of campaigns) {
      if (campaign.endDate && campaign.endDate < now) continue;
      const rewardType = campaign.giftCampaignTemplate
        ? CampaignRewardType.GIFT
        : campaign.voucherCampaignTemplate
          ? CampaignRewardType.VOUCHER
          : null;
      if (!rewardType) continue;
      result.push({ id: campaign.id, slug: campaign.slug, rewardType });
    }

    this.logger.log(
      `Available birthday campaigns: [${result.map((c) => `${c.slug}:${c.rewardType}`).join(', ')}]`,
      context,
    );
    return result;
  }

  /**
   * The birthday CampaignRecipient for this user/campaign in a given year, or
   * null. Its presence means the user is a valid birthday recipient that year
   * (Flow 1 granted the reward) — used to gate the automatic greeting sender.
   */
  async findBirthdayRecipient(
    campaignId: string,
    userId: string,
    year: number,
  ): Promise<CampaignRecipient | null> {
    return this.recipientRepository.findOne({
      where: {
        campaign: { id: campaignId },
        user: { id: userId },
        year,
      },
    });
  }

  /**
   * Atomically claim the birthday greeting for a recipient: set greetedAt only
   * when it is still null. Returns true if this caller won the claim (should
   * send), false if it was already greeted. Guards against duplicate greetings
   * under races, so a user is greeted at most once per year.
   */
  async claimBirthdayGreeting(recipientId: string): Promise<boolean> {
    const result = await this.recipientRepository.update(
      { id: recipientId, greetedAt: IsNull() },
      { greetedAt: new Date() },
    );
    return result.affected === 1;
  }

  /**
   * Release a previously claimed greeting (set greetedAt back to null) so it can
   * be retried later, e.g. when the provider did not accept the message.
   */
  async releaseBirthdayGreeting(recipientId: string): Promise<void> {
    await this.recipientRepository.update(
      { id: recipientId },
      { greetedAt: null },
    );
  }

  /**
   * Vouchers a user received from a given campaign in a given year (via the
   * campaign recipients). Used to list the campaign's vouchers in the greeting.
   */
  async getUserBirthdayVouchers(
    campaignId: string,
    userId: string,
    year: number,
  ): Promise<BirthdayVoucherInfo[]> {
    const recipients = await this.recipientRepository.find({
      where: {
        campaign: { id: campaignId },
        user: { id: userId },
        year,
      },
      relations: { voucher: { voucherProducts: { product: true } } },
    });

    return recipients
      .filter((r) => r.voucher)
      .map((r) => ({
        code: r.voucher.code,
        title: r.voucher.title,
        value: r.voucher.value,
        valueType: r.voucher.valueType,
        products: (r.voucher.voucherProducts ?? [])
          .map((vp) => vp.product?.name)
          .filter((name): name is string => !!name),
      }));
  }

  async triggerForUser(user: User, campaignType: CampaignType): Promise<void> {
    const context = `${CampaignService.name}.${this.triggerForUser.name}`;

    const roleName =
      user.role?.name ??
      (
        await this.userRepository.findOne({
          where: { id: user.id },
          relations: { role: true },
        })
      )?.role?.name;

    if (roleName !== RoleEnum.Customer) {
      this.logger.log(
        `Skipping campaign for non-customer user ${user.id} (role: ${roleName})`,
        context,
      );
      return;
    }

    const now = new Date();

    const campaigns = await this.campaignRepository.find({
      where: {
        type: campaignType,
        status: CampaignStatus.OPENING,
        startDate: LessThanOrEqual(now),
      },
      relations: {
        voucherGroup: true,
        voucherCampaignTemplate: true,
        giftCampaignTemplate: true,
      },
    });

    const activeCampaigns = campaigns.filter(
      (c) => !c.endDate || c.endDate >= now,
    );

    for (const campaign of activeCampaigns) {
      const eligible = await this.checkEligibility(campaign, user);
      if (!eligible) continue;

      try {
        const strategy = this.selectStrategy(campaign);
        await strategy.execute(campaign, user);
      } catch (error) {
        this.logger.warn(
          `Campaign ${campaign.slug} failed for user ${user.id}: ${error.message}`,
          context,
        );
      }
    }
  }

  /**
   * Enforce at most one user-birthday campaign running in any time period:
   * the [startDate, endDate] window (endDate null = open-ended) must not overlap
   * another non-closed user-birthday campaign. `excludeId` skips the campaign
   * being updated. Two windows overlap when aStart <= bEnd && bStart <= aEnd.
   */
  private async assertNoOverlappingBirthdayCampaign(
    startDate: Date,
    endDate: Date | null | undefined,
    excludeId?: string,
  ): Promise<void> {
    const others = await this.campaignRepository.find({
      where: {
        type: CampaignType.USER_BIRTHDAY,
        status: In([CampaignStatus.SCHEDULED, CampaignStatus.OPENING]),
      },
    });

    const aStart = startDate.getTime();
    const aEnd = endDate ? endDate.getTime() : Number.POSITIVE_INFINITY;

    for (const other of others) {
      if (excludeId && other.id === excludeId) continue;
      const bStart = other.startDate.getTime();
      const bEnd = other.endDate
        ? other.endDate.getTime()
        : Number.POSITIVE_INFINITY;
      if (aStart <= bEnd && bStart <= aEnd) {
        throw new CampaignException(
          CampaignValidation.CAMPAIGN_BIRTHDAY_PERIOD_OVERLAP,
        );
      }
    }
  }

  private async checkEligibility(
    campaign: Campaign,
    user: User,
  ): Promise<boolean> {
    const currentYear = new Date().getFullYear();

    if (campaign.type === CampaignType.USER_BIRTHDAY) {
      // One birthday reward per user per year across ALL user-birthday campaigns
      // (voucher + gift), not per campaign — so a user with both a voucher and a
      // gift birthday campaign open receives only the first one this year.
      const count = await this.recipientRepository.count({
        where: {
          campaign: { type: CampaignType.USER_BIRTHDAY },
          user: { id: user.id },
          year: currentYear,
        },
      });
      if (count > 0) return false;
    } else {
      const count = await this.recipientRepository.count({
        where: {
          campaign: { id: campaign.id },
          user: { id: user.id },
        },
      });
      if (count > 0) return false;
    }

    if (campaign.recipientLimit != null) {
      const totalRecipients = await this.recipientRepository.count({
        where: { campaign: { id: campaign.id } },
      });
      if (totalRecipients >= campaign.recipientLimit) return false;
    }

    return true;
  }

  private async validateProductSlugs(slugs: string[]): Promise<void> {
    const found = await this.productRepository.find({
      where: { slug: In(slugs) },
      select: ['slug'],
    });
    if (found.length !== slugs.length) {
      throw new CampaignException(
        CampaignValidation.CAMPAIGN_PRODUCT_NOT_FOUND,
      );
    }
  }

  private validateCampaignTemplate(dto: CreateCampaignRequestDto): void {
    const hasVoucher = dto.voucherCampaignTemplate != null;
    const hasGift = dto.giftCampaignTemplate != null;

    switch (dto.campaignType) {
      case CampaignRewardType.VOUCHER:
        if (!hasVoucher) {
          throw new CampaignException(
            CampaignValidation.CAMPAIGN_TEMPLATE_REQUIRED_FOR_TYPE,
          );
        }
        if (hasGift) {
          throw new CampaignException(
            CampaignValidation.CAMPAIGN_TEMPLATE_TYPE_MISMATCH,
          );
        }
        break;
      case CampaignRewardType.GIFT:
        if (!hasGift) {
          throw new CampaignException(
            CampaignValidation.CAMPAIGN_TEMPLATE_REQUIRED_FOR_TYPE,
          );
        }
        if (hasVoucher) {
          throw new CampaignException(
            CampaignValidation.CAMPAIGN_TEMPLATE_TYPE_MISMATCH,
          );
        }
        break;
      default:
        throw new CampaignException(
          CampaignValidation.UNSUPPORTED_CAMPAIGN_TYPE,
        );
    }
  }

  private selectStrategy(campaign: Campaign): ICampaignStrategy {
    switch (campaign.type) {
      case CampaignType.NEW_USER:
        return this.newUserCampaignStrategy;
      case CampaignType.USER_BIRTHDAY:
        // Reward type is implied by which template is populated: a gift campaign
        // (giftCampaignTemplate set) records the recipient only; otherwise the
        // existing voucher strategy runs unchanged.
        return campaign.giftCampaignTemplate
          ? this.giftBirthdayCampaignStrategy
          : this.userBirthdayCampaignStrategy;
      default:
        throw new CampaignException(
          CampaignValidation.UNSUPPORTED_CAMPAIGN_TYPE,
        );
    }
  }
}
