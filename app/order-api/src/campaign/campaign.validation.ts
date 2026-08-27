import { createErrorCode, TErrorCodeValue } from 'src/app/app.validation';
import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { CampaignRewardType } from './campaign.constants';

export type TCampaignErrorCodeKey =
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_VOUCHER_GROUP_NOT_FOUND'
  | 'CAMPAIGN_PRODUCT_NOT_FOUND'
  | 'CAMPAIGN_EXECUTION_ERROR'
  | 'UNSUPPORTED_CAMPAIGN_TYPE'
  | 'CAMPAIGN_INVALID_DATE_RANGE'
  | 'CAMPAIGN_INVALID_STATUS_TRANSITION'
  | 'CAMPAIGN_DURATION_REQUIRED_WITHOUT_END_DATE'
  | 'CAMPAIGN_HAS_VOUCHERS'
  | 'CAMPAIGN_TEMPLATE_REQUIRED_FOR_TYPE'
  | 'CAMPAIGN_TEMPLATE_TYPE_MISMATCH'
  | 'CAMPAIGN_GIFT_NOT_YET_SUPPORTED'
  | 'CAMPAIGN_VOUCHER_GROUP_REQUIRED'
  | 'CAMPAIGN_BIRTHDAY_PERIOD_OVERLAP'
  | 'CAMPAIGN_COIN_BUDGET_EXHAUSTED'
  | 'CAMPAIGN_COIN_LIMIT_LESS_THAN_COIN_PER_USER'
  | 'CAMPAIGN_NEW_USER_PERIOD_OVERLAP';

export type TCampaignErrorCode = Record<TCampaignErrorCodeKey, TErrorCodeValue>;

// 159901 - 160000
export const CampaignValidation: TCampaignErrorCode = {
  CAMPAIGN_NOT_FOUND: createErrorCode(159901, 'Campaign not found'),
  CAMPAIGN_VOUCHER_GROUP_NOT_FOUND: createErrorCode(
    159902,
    'Voucher group not found',
  ),
  CAMPAIGN_PRODUCT_NOT_FOUND: createErrorCode(159903, 'Product not found'),
  CAMPAIGN_EXECUTION_ERROR: createErrorCode(
    159904,
    'Error executing campaign strategy',
  ),
  UNSUPPORTED_CAMPAIGN_TYPE: createErrorCode(
    159905,
    'Unsupported campaign type',
  ),
  CAMPAIGN_INVALID_DATE_RANGE: createErrorCode(
    159906,
    'endDate must be after startDate',
  ),
  CAMPAIGN_INVALID_STATUS_TRANSITION: createErrorCode(
    159907,
    'Campaign status does not match its date range',
  ),
  CAMPAIGN_DURATION_REQUIRED_WITHOUT_END_DATE: createErrorCode(
    159908,
    'duration is required when campaign has no endDate',
  ),
  CAMPAIGN_HAS_VOUCHERS: createErrorCode(
    159909,
    'Cannot delete campaign that already has vouchers created',
  ),
  CAMPAIGN_TEMPLATE_REQUIRED_FOR_TYPE: createErrorCode(
    159910,
    'The concrete template required by this campaignType is missing',
  ),
  CAMPAIGN_TEMPLATE_TYPE_MISMATCH: createErrorCode(
    159911,
    'The provided template does not match the campaignType',
  ),
  CAMPAIGN_GIFT_NOT_YET_SUPPORTED: createErrorCode(
    159912,
    'Gift campaigns are not available yet (pending schema migration)',
  ),
  CAMPAIGN_VOUCHER_GROUP_REQUIRED: createErrorCode(
    159913,
    'voucherGroupSlug is required for voucher campaigns',
  ),
  CAMPAIGN_BIRTHDAY_PERIOD_OVERLAP: createErrorCode(
    159914,
    'Another user-birthday campaign already runs in this time period',
  ),
  CAMPAIGN_COIN_BUDGET_EXHAUSTED: createErrorCode(
    159915,
    'The campaign coin budget is exhausted',
  ),
  CAMPAIGN_COIN_LIMIT_LESS_THAN_COIN_PER_USER: createErrorCode(
    159916,
    'totalCoinLimit must be at least coinPerUser',
  ),
  CAMPAIGN_NEW_USER_PERIOD_OVERLAP: createErrorCode(
    159917,
    'Campaign is overlapping, please close the opening campaign before creating a new campaign',
  ),
};

/**
 * Class-level rule (attached to `campaignType`): each campaignType must carry
 * exactly its own concrete template and no foreign template.
 *   - VOUCHER -> voucherCampaignTemplate required, other templates forbidden
 *   - GIFT    -> giftCampaignTemplate required, other templates forbidden
 *   - COIN    -> coinCampaignTemplate required, other templates forbidden
 */
export function MatchTemplateToCampaignType(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'matchTemplateToCampaignType',
      target: object.constructor,
      propertyName: propertyName,
      options: {
        message:
          'campaignType must be provided with its matching concrete template ' +
          '(voucher -> voucherCampaignTemplate, gift -> giftCampaignTemplate, ' +
          'coin -> coinCampaignTemplate) and no other template',
        ...validationOptions,
      },
      validator: {
        validate(value: any, args: ValidationArguments) {
          const obj = args.object as any;
          const hasVoucher = obj.voucherCampaignTemplate != null;
          const hasGift = obj.giftCampaignTemplate != null;
          const hasCoin = obj.coinCampaignTemplate != null;

          if (value === CampaignRewardType.VOUCHER) {
            return hasVoucher && !hasGift && !hasCoin;
          }
          if (value === CampaignRewardType.GIFT) {
            return hasGift && !hasVoucher && !hasCoin;
          }
          if (value === CampaignRewardType.COIN) {
            return hasCoin && !hasVoucher && !hasGift;
          }
          // Unknown campaignType is handled by @IsEnum; don't double-report.
          return true;
        },
      },
    });
  };
}
