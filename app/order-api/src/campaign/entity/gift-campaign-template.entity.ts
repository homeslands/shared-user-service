import { AutoMap } from '@automapper/classes';
import { Base } from 'src/app/base.entity';
import { Column, Entity, OneToOne } from 'typeorm';
import { Campaign } from './campaign.entity';

@Entity({ name: 'gift_campaign_template_tbl' })
export class GiftCampaignTemplate extends Base {
  @AutoMap()
  @Column({ name: 'title_column' })
  title: string;

  @AutoMap()
  @Column({ name: 'description_column', nullable: true })
  description?: string;

  @AutoMap()
  @Column({ name: 'duration_column', nullable: true })
  duration: number;

  @OneToOne(() => Campaign, (campaign) => campaign.giftCampaignTemplate)
  campaign: Campaign;
}
