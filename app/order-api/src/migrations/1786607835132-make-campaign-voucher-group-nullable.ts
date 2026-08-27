import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeCampaignVoucherGroupNullable1786607835132
  implements MigrationInterface
{
  name = 'MakeCampaignVoucherGroupNullable1786607835132';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Gift campaigns don't use a voucher group -> allow the FK to be null.
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` DROP FOREIGN KEY \`FK_e942bef77d295e38f7a8e80203a\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` MODIFY \`voucher_group_column\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` ADD CONSTRAINT \`FK_e942bef77d295e38f7a8e80203a\` FOREIGN KEY (\`voucher_group_column\`) REFERENCES \`voucher_group_tbl\`(\`id_column\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: reverting fails if any campaign row has a null voucher_group_column
    // (e.g. gift campaigns created after this migration).
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` DROP FOREIGN KEY \`FK_e942bef77d295e38f7a8e80203a\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` MODIFY \`voucher_group_column\` varchar(36) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`campaign_tbl\` ADD CONSTRAINT \`FK_e942bef77d295e38f7a8e80203a\` FOREIGN KEY (\`voucher_group_column\`) REFERENCES \`voucher_group_tbl\`(\`id_column\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
