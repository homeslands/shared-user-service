import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBirthdayStrategyZaloConfig1785813774256 implements MigrationInterface {
  name = 'AddBirthdayStrategyZaloConfig1785813774256';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO \`zalo_oa_connector_config_tbl\`
        (\`id_column\`, \`slug_column\`, \`strategy_column\`, \`template_id_column\`)
       SELECT UUID(), SUBSTRING(REPLACE(UUID(), '-', ''), 1, 10), 'birthday', '615922'
       WHERE NOT EXISTS (
         SELECT 1 FROM \`zalo_oa_connector_config_tbl\`
         WHERE \`strategy_column\` = 'birthday'
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM \`zalo_oa_connector_config_tbl\` WHERE \`strategy_column\` = 'birthday'`,
    );
  }
}
