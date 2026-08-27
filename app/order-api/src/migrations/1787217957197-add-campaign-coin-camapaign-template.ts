import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCampaignCoinCamapaignTemplate1787217957197 implements MigrationInterface {

  name = 'AddCampaignCoinCamapaignTemplate1787217957197';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`coin_campaign_template_tbl\` (\`id_column\` varchar(36) NOT NULL, \`slug_column\` varchar(255) NOT NULL, \`created_at_column\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at_column\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at_column\` datetime(6) NULL, \`created_by_column\` varchar(255) NULL, \`title_column\` varchar(255) NOT NULL, \`description_column\` varchar(255) NULL, \`coin_per_user_column\` int NOT NULL, \`total_coin_limit_column\` int NULL, \`remaining_coin_column\` int NULL, UNIQUE INDEX \`IDX_coin_campaign_template_slug\` (\`slug_column\`), PRIMARY KEY (\`id_column\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` ADD \`coin_campaign_template_column\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`REL_campaign_coin_campaign_template\` ON \`campaign_tbl\` (\`coin_campaign_template_column\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` ADD CONSTRAINT \`FK_campaign_coin_campaign_template\` FOREIGN KEY (\`coin_campaign_template_column\`) REFERENCES \`coin_campaign_template_tbl\`(\`id_column\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_recipient_tbl\` ADD \`coin_amount_column\` int NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`campaign_recipient_tbl\` DROP COLUMN \`coin_amount_column\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` DROP FOREIGN KEY \`FK_campaign_coin_campaign_template\``,
    );
    await queryRunner.query(
      `DROP INDEX \`REL_campaign_coin_campaign_template\` ON \`campaign_tbl\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` DROP COLUMN \`coin_campaign_template_column\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_coin_campaign_template_slug\` ON \`coin_campaign_template_tbl\``,
    );
    await queryRunner.query(`DROP TABLE \`coin_campaign_template_tbl\``);
  }

}
