import { CampaignRewardType } from 'src/campaign/campaign.constants';

// Job names used on the user-birthday queue.
// A birthday user gets a single multi-channel message (Zalo, falling back to SMS
// on the provider side) plus an email (only when the user has an email). Each job
// is processed and retried on its own.
export const SEND_BIRTHDAY_MULTI_CHANNEL_JOB = 'send-birthday-multi-channel';
export const SEND_BIRTHDAY_EMAIL_JOB = 'send-birthday-email';

// Channel a single birthday job targets.
// MULTI_CHANNEL is one eSMS MultiChannelMessage call: Zalo first, then SMS.
export enum BirthdayChannel {
  MULTI_CHANNEL = 'multi-channel',
  EMAIL = 'email',
}

// Minimal, serializable snapshot of the user written to Redis for processing.
// Only the fields the greeting senders need are carried in the job payload.
export interface BirthdayJobData {
  id: string;
  slug: string;
  phonenumber: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  // Campaign this greeting belongs to; lets the email look up the campaign's
  // vouchers and pick the right content.
  campaignId: string;
  campaignSlug: string;
  rewardType: CampaignRewardType;
}
