import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModifyGiftTemplateCampaign1785746833793
  implements MigrationInterface
{
  name = 'ModifyGiftTemplateCampaign1785746833793';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`gift_campaign_template_tbl\` DROP COLUMN \`max_per_product_column\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`gift_campaign_template_tbl\` DROP COLUMN \`payment_methods_column\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`gift_campaign_template_tbl\` DROP COLUMN \`product_slugs_column\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`gift_campaign_template_tbl\` ADD \`product_slugs_column\` json NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`gift_campaign_template_tbl\` ADD \`payment_methods_column\` json NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`gift_campaign_template_tbl\` ADD \`max_per_product_column\` json NOT NULL`,
    );
  }
}
