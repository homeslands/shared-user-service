import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGreetedAtCampaignRecipient1786153200000
  implements MigrationInterface
{
  name = 'AddGreetedAtCampaignRecipient1786153200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`campaign_recipient_tbl\` ADD \`greeted_at_column\` timestamp NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`campaign_recipient_tbl\` DROP COLUMN \`greeted_at_column\``,
    );
  }
}
