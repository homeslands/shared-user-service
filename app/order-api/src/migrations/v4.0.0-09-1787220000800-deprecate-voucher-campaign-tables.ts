import { MigrationInterface, QueryRunner } from 'typeorm';

// Step 6.17 (6B): tables of vouchers, campaigns and the user groups they
// target.
// The modules that mapped these tables were removed from shared-user (they
// belong to trend). The tables are renamed to _deprecated_*, not dropped:
// the rows of the mono copy stay readable for the comparison and merge with
// trend_db that comes before this release
// (progress/buoc-trien-khai-gd2-10.md, step 6.17). DROP is stage 10, a
// release of its own (rule 1 of 14/11/2026).
//
// One RENAME TABLE statement: MySQL renames every pair at once, and the
// statement fails as a whole if a table is missing or already renamed.
// Foreign keys and triggers follow the renamed table. role_tbl,
// permission_tbl, authority_tbl and authority_group_tbl are live tables of
// shared-user (QD15) and are never renamed.
//
// The timestamp is above AddCampaignCoinCamapaignTemplate1787217957197, the
// last migration of the mono copy, which creates coin_campaign_template_tbl
// and alters campaign_tbl and campaign_recipient_tbl. TypeORM runs pending
// migrations in timestamp order, so a database that has not run that one yet
// runs it before this rename.
export class DeprecateVoucherCampaignTables1787220000800
  implements MigrationInterface
{
  name = 'DeprecateVoucherCampaignTables1787220000800';

  private readonly tables = [
    'campaign_recipient_tbl',
    'campaign_tbl',
    'coin_campaign_template_tbl',
    'gift_campaign_template_tbl',
    'user_group_member_tbl',
    'user_group_tbl',
    'voucher_campaign_template_tbl',
    'voucher_group_tbl',
    'voucher_payment_method_tbl',
    'voucher_product_tbl',
    'voucher_tbl',
    'voucher_user_group_tbl',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `RENAME TABLE ${this.tables.map((t) => `\`${t}\` TO \`_deprecated_${t}\``).join(', ')}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `RENAME TABLE ${this.tables.map((t) => `\`_deprecated_${t}\` TO \`${t}\``).join(', ')}`,
    );
  }
}
