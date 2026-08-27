// WHEN a campaign fires (the trigger / audience).
export enum CampaignType {
  NEW_USER = 'new-user',
  USER_BIRTHDAY = 'user-birthday',
}

// WHAT a campaign grants. Each reward type requires its own concrete template.
export enum CampaignRewardType {
  VOUCHER = 'voucher',
  GIFT = 'gift',
  COIN = 'coin',
}

export enum CampaignStatus {
  SCHEDULED = 'scheduled',
  OPENING = 'opening',
  CLOSED = 'closed',
}

export const CampaignAction = {
  USER_CREATED: 'campaign.user.created',
  USER_BIRTHDAY_TRIGGERED: 'campaign.user.birthday.triggered',
} as const;

// Lightweight view of an available birthday campaign, used by the greeting sender
// to route channels (by reward type) and to fetch the campaign's vouchers.
export interface AvailableBirthdayCampaign {
  id: string;
  slug: string;
  rewardType: CampaignRewardType;
}

// A voucher belonging to a campaign, as shown to the user (e.g. in the email).
export interface BirthdayVoucherInfo {
  code: string;
  title: string;
  // Discount value and its unit ('percentage' -> %, 'amount' -> đ).
  value: number;
  valueType: string;
  // Names of the products the voucher applies to (empty = all products).
  products: string[];
}
