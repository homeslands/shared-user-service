import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModifyZaloHistory1786067285865 implements MigrationInterface {
  name = 'ModifyZaloHistory1786067285865';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`zalo_oa_connector_history_tbl\` CHANGE \`token_id_column\` \`token_id_column\` varchar(255) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`zalo_oa_connector_history_tbl\` CHANGE \`token_id_column\` \`token_id_column\` varchar(255) NOT NULL`,
    );
  }
}
