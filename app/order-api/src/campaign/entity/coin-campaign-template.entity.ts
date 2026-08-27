import { AutoMap } from '@automapper/classes';
import { Base } from 'src/app/base.entity';
import { Column, Entity, OneToOne } from 'typeorm';
import { Campaign } from './campaign.entity';

@Entity({ name: 'coin_campaign_template_tbl' })
export class CoinCampaignTemplate extends Base {
  @AutoMap()
  @Column({ name: 'title_column' })
  title: string;

  @AutoMap()
  @Column({ name: 'description_column', nullable: true })
  description?: string;

  // Coins credited to each recipient's balance.
  @AutoMap()
  @Column({ name: 'coin_per_user_column', type: 'int' })
  coinPerUser: number;

  // Total coin budget of the campaign. Null = unlimited.
  @AutoMap()
  @Column({ name: 'total_coin_limit_column', type: 'int', nullable: true })
  totalCoinLimit?: number;

  // Coins left in the budget. Starts at totalCoinLimit and is decremented on
  // each grant; when it can no longer cover coinPerUser the campaign is CLOSED.
  // Null = unlimited (mirrors totalCoinLimit).
  @AutoMap()
  @Column({ name: 'remaining_coin_column', type: 'int', nullable: true })
  remainingCoin?: number;

  @OneToOne(() => Campaign, (campaign) => campaign.coinCampaignTemplate)
  campaign: Campaign;
}
