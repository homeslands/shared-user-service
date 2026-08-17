import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { QueueRegisterKey } from 'src/app/app.constants';
import { MailService } from 'src/mail/mail.service';
import { ZaloOaConnectorClient } from 'src/zalo-oa-connector/zalo-oa-connector.client';
import { ZaloOaConnectorConfig } from 'src/zalo-oa-connector/entity/zalo-oa-connector.entity';
import { ZaloOaConnectorHistory } from 'src/zalo-oa-connector/entity/zalo-oa-connector-history.entity';
import {
  SmsDataRequestDto,
  ZaloDataRequestDto,
  ZaloOaInitiateSmsByMultiChannelMessageRequestDto,
  ZaloOaInitiateSmsResponseDto,
} from 'src/zalo-oa-connector/zalo-oa-connector.dto';
import {
  fillBirthdayContent,
  SMSChannel,
  ZaloAoStatusCode,
  ZaloOaStrategy,
} from 'src/zalo-oa-connector/zalo-oa-connector.constants';
import { getRandomString } from 'src/helper';
import { CampaignService } from 'src/campaign/campaign.service';
import {
  BirthdayVoucherInfo,
  CampaignRewardType,
} from 'src/campaign/campaign.constants';
import { SystemConfigService } from 'src/system-config/system-config.service';
import { SystemConfigKey } from 'src/system-config/system-config.constant';
import {
  BirthdayChannel,
  BirthdayJobData,
  SEND_BIRTHDAY_EMAIL_JOB,
  SEND_BIRTHDAY_MULTI_CHANNEL_JOB,
} from './user-birthday.constants';

@Processor(QueueRegisterKey.USER_BIRTHDAY, { concurrency: 20 })
@Injectable()
export class UserBirthdayConsumer extends WorkerHost {
  private zaloOaApiKey: string;
  private zaloOaSecretKey: string;
  private zaloOaId: string;

  constructor(
    @InjectRepository(ZaloOaConnectorConfig)
    private readonly zaloOaConnectorConfigRepository: Repository<ZaloOaConnectorConfig>,
    @InjectRepository(ZaloOaConnectorHistory)
    private readonly zaloOaConnectorHistoryRepository: Repository<ZaloOaConnectorHistory>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: Logger,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly zaloOaConnectorClient: ZaloOaConnectorClient,
    private readonly campaignService: CampaignService,
    private readonly systemConfigService: SystemConfigService,
  ) {
    super();
    this.zaloOaApiKey = this.configService.get<string>('ZALO_OA_API_KEY');
    this.zaloOaSecretKey = this.configService.get<string>('ZALO_OA_SECRET_KEY');
    this.zaloOaId = this.configService.get<string>('ZALO_OA_ID');
  }

  /**
   * Each birthday job is one channel: a single multi-channel message (Zalo, with
   * SMS fallback on the provider side) or an email. They are processed
   * independently and at the same time.
   * @returns the channel that accepted the greeting, or null if it did not.
   */
  async process(job: Job<BirthdayJobData>): Promise<BirthdayChannel | null> {
    const context = `${UserBirthdayConsumer.name}.${this.process.name}`;
    let accepted = false;
    let channel: BirthdayChannel | null = null;

    switch (job.name) {
      case SEND_BIRTHDAY_MULTI_CHANNEL_JOB:
        channel = BirthdayChannel.MULTI_CHANNEL;
        accepted = await this.sendBirthdayMultiChannel(job.data);
        break;
      case SEND_BIRTHDAY_EMAIL_JOB:
        channel = BirthdayChannel.EMAIL;
        accepted = await this.sendBirthdayEmail(job.data);
        break;
      default:
        return null;
    }

    this.logger.log(
      `Birthday greeting for user ${job.data.slug} on channel ${channel}: accepted=${accepted}`,
      context,
    );
    return accepted ? channel : null;
  }

  /**
   * Fetch the Zalo OA connector config for the birthday strategy.
   * Returns null (instead of throwing) so the caller can skip the channel.
   */
  private async getBirthdayZaloConfig(): Promise<ZaloOaConnectorConfig | null> {
    const context = `${UserBirthdayConsumer.name}.${this.getBirthdayZaloConfig.name}`;
    const config = await this.zaloOaConnectorConfigRepository.findOne({
      where: { strategy: ZaloOaStrategy.BIRTHDAY },
    });
    if (!config) {
      this.logger.warn(
        `Zalo OA connector config not found for strategy ${ZaloOaStrategy.BIRTHDAY}`,
        context,
      );
      return null;
    }
    return config;
  }

  /**
   * A send is considered accepted when the provider returns CodeResult "100"
   * and issues an SMSID for the request.
   */
  private isAccepted(response: ZaloOaInitiateSmsResponseDto): boolean {
    return (
      response?.CodeResult === ZaloAoStatusCode.SUCCESS && !!response?.SMSID
    );
  }

  /**
   * Backend URL used to build the provider status callback, same as AuthService.
   */
  private async getBackendUrl(): Promise<string> {
    const context = `${UserBirthdayConsumer.name}.${this.getBackendUrl.name}`;
    const url = await this.systemConfigService.get(SystemConfigKey.BACKEND_URL);
    if (!url) {
      this.logger.error(`Backend URL not found`, null, context);
    }
    return url;
  }

  /**
   * Greet the user through the eSMS MultiChannelMessage endpoint. Channels are
   * [Zalo, SMS]: the provider tries Zalo first and falls back to SMS on its side,
   * so a single call covers "send Zalo, else SMS".
   */
  private async sendBirthdayMultiChannel(
    user: BirthdayJobData,
  ): Promise<boolean> {
    const context = `${UserBirthdayConsumer.name}.${this.sendBirthdayMultiChannel.name}`;
    if (!user.phonenumber) {
      this.logger.warn(`User ${user.slug} has no phone number`, context);
      return false;
    }
    const config = await this.getBirthdayZaloConfig();
    if (!config) return false;
    try {
      const id = user.slug;
      const name = user.lastName ?? '';
      const backendUrl = await this.getBackendUrl();
      const requestIdZns = getRandomString();
      const requestIdSms = getRandomString();

      const request = new ZaloOaInitiateSmsByMultiChannelMessageRequestDto();
      request.ApiKey = this.zaloOaApiKey;
      request.SecretKey = this.zaloOaSecretKey;
      request.Phone = user.phonenumber;
      request.Channels = [SMSChannel.ZALO, SMSChannel.SMS];
      request.Data = [
        {
          TempID: config.templateId,
          Params: [name, id],
          OAID: this.zaloOaId,
          campaignid: config.strategy,
          CallbackUrl: `${backendUrl}/zalo-oa-connector/callback/status`,
          RequestId: requestIdZns,
          Sandbox: '0',
          SendingMode: '1',
        } as ZaloDataRequestDto,
        {
          Content: fillBirthdayContent(name),
          IsUnicode: '0',
          SmsType: '2',
          Brandname: 'TrendCoffee',
          CallbackUrl: `${backendUrl}/zalo-oa-connector/callback/status`,
          RequestId: requestIdSms,
          Sandbox: '0',
        } as SmsDataRequestDto,
      ];

      const response =
        await this.zaloOaConnectorClient.initiateBirthdaySmsByMultiChannelMessage(
          request,
        );
      const accepted = this.isAccepted(response);
      if (response?.SMSID) {
        // Birthday campaign has no verify-phone-number token, so tokenId is left
        // null (only allowed for this strategy).
        const zaloOaConnectorHistory = new ZaloOaConnectorHistory();
        Object.assign(zaloOaConnectorHistory, {
          tokenId: null,
          smsId: response.SMSID,
          requestId: `${requestIdZns}-${requestIdSms}`,
          templateId: config.templateId,
          strategy: config.strategy,
        } as ZaloOaConnectorHistory);
        await this.zaloOaConnectorHistoryRepository.save(zaloOaConnectorHistory);
      }
      this.logger.log(
        `Multi-channel birthday for user ${user.slug}: accepted=${accepted}, response=${JSON.stringify(response)}`,
        context,
      );
      return accepted;
    } catch (error) {
      this.logger.error(
        `Error sending multi-channel birthday to user ${user.slug}: ${error.message}`,
        error.stack,
        context,
      );
      return false;
    }
  }

  /**
   * Greet the user via email. For a voucher campaign the email lists the
   * vouchers the user received from that campaign this year.
   */
  private async sendBirthdayEmail(user: BirthdayJobData): Promise<boolean> {
    const context = `${UserBirthdayConsumer.name}.${this.sendBirthdayEmail.name}`;
    if (!user.email) {
      this.logger.warn(`User ${user.slug} has no email`, context);
      return false;
    }
    try {
      let vouchers: BirthdayVoucherInfo[] = [];
      if (user.rewardType === CampaignRewardType.VOUCHER && user.campaignId) {
        vouchers = await this.campaignService.getUserBirthdayVouchers(
          user.campaignId,
          user.id,
          new Date().getFullYear(),
        );
      }
      await this.mailService.sendBirthdayGreeting(
        user,
        vouchers,
        user.rewardType,
      );
      this.logger.log(
        `Email birthday for user ${user.slug}: accepted=true, email=${user.email}, vouchers=${vouchers.length}`,
        context,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending email birthday to user ${user.slug}: ${error.message}`,
        error.stack,
        context,
      );
      return false;
    }
  }
}
