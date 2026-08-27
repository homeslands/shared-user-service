import { AutomapperProfile, InjectMapper } from '@automapper/nestjs';
import {
  createMap,
  extend,
  forMember,
  mapFrom,
  Mapper,
} from '@automapper/core';
import { Injectable } from '@nestjs/common';
import { Campaign } from './entity/campaign.entity';
import { VoucherCampaignTemplate } from './entity/voucher-campaign-template.entity';
import { GiftCampaignTemplate } from './entity/gift-campaign-template.entity';
import { CoinCampaignTemplate } from './entity/coin-campaign-template.entity';
import {
  CampaignResponseDto,
  CoinCampaignTemplateResponseDto,
  CreateCampaignRequestDto,
  GiftCampaignTemplateResponseDto,
  VoucherCampaignTemplateResponseDto,
} from './campaign.dto';
import { baseMapper } from 'src/app/base.mapper';

@Injectable()
export class CampaignProfile extends AutomapperProfile {
  constructor(@InjectMapper() mapper: Mapper) {
    super(mapper);
  }

  override get profile() {
    return (mapper: Mapper) => {
      createMap(mapper, CreateCampaignRequestDto, Campaign);
      createMap(
        mapper,
        VoucherCampaignTemplate,
        VoucherCampaignTemplateResponseDto,
        forMember(
          (dest) => dest.paymentMethods,
          mapFrom((src) => src.paymentMethods ?? []),
        ),
        forMember(
          (dest) => dest.productSlugs,
          mapFrom((src) => src.productSlugs ?? []),
        ),
        extend(baseMapper(mapper)),
      );
      createMap(
        mapper,
        GiftCampaignTemplate,
        GiftCampaignTemplateResponseDto,
        extend(baseMapper(mapper)),
      );
      createMap(
        mapper,
        CoinCampaignTemplate,
        CoinCampaignTemplateResponseDto,
        extend(baseMapper(mapper)),
      );
      createMap(
        mapper,
        Campaign,
        CampaignResponseDto,
        forMember(
          (dest) => dest.voucherGroup,
          mapFrom((src) =>
            src.voucherGroup
              ? { slug: src.voucherGroup.slug, title: src.voucherGroup.title }
              : undefined,
          ),
        ),
        forMember(
          (dest) => dest.voucherCampaignTemplate,
          mapFrom((src) =>
            src.voucherCampaignTemplate
              ? mapper.map(
                  src.voucherCampaignTemplate,
                  VoucherCampaignTemplate,
                  VoucherCampaignTemplateResponseDto,
                )
              : undefined,
          ),
        ),
        forMember(
          (dest) => dest.giftCampaignTemplate,
          mapFrom((src) =>
            src.giftCampaignTemplate
              ? mapper.map(
                  src.giftCampaignTemplate,
                  GiftCampaignTemplate,
                  GiftCampaignTemplateResponseDto,
                )
              : undefined,
          ),
        ),
        forMember(
          (dest) => dest.coinCampaignTemplate,
          mapFrom((src) =>
            src.coinCampaignTemplate
              ? mapper.map(
                  src.coinCampaignTemplate,
                  CoinCampaignTemplate,
                  CoinCampaignTemplateResponseDto,
                )
              : undefined,
          ),
        ),
        extend(baseMapper(mapper)),
      );
    };
  }
}
