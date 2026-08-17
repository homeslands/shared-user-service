import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGiftTemplateCampaign1785738246303 implements MigrationInterface {
  name = 'AddGiftTemplateCampaign1785738246303';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`gift_campaign_template_tbl\` (\`id_column\` varchar(36) NOT NULL, \`slug_column\` varchar(255) NOT NULL, \`created_at_column\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at_column\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at_column\` datetime(6) NULL, \`created_by_column\` varchar(255) NULL, \`title_column\` varchar(255) NOT NULL, \`description_column\` varchar(255) NULL, \`product_slugs_column\` json NOT NULL, \`max_per_product_column\` json NOT NULL, \`duration_column\` int NULL, \`payment_methods_column\` json NULL, UNIQUE INDEX \`IDX_bb49518c9f861ab7dc9789e782\` (\`slug_column\`), PRIMARY KEY (\`id_column\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` ADD \`gift_campaign_template_column\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`REL_0fc77d15250098aeb0759e1650\` ON \`campaign_tbl\` (\`gift_campaign_template_column\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` ADD CONSTRAINT \`FK_0fc77d15250098aeb0759e1650d\` FOREIGN KEY (\`gift_campaign_template_column\`) REFERENCES \`gift_campaign_template_tbl\`(\`id_column\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` DROP FOREIGN KEY \`FK_0fc77d15250098aeb0759e1650d\``,
    );
    await queryRunner.query(
      `DROP INDEX \`REL_0fc77d15250098aeb0759e1650\` ON \`campaign_tbl\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` DROP COLUMN \`gift_campaign_template_column\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_bb49518c9f861ab7dc9789e782\` ON \`gift_campaign_template_tbl\``,
    );
    await queryRunner.query(`DROP TABLE \`gift_campaign_template_tbl\``);
  }
}
