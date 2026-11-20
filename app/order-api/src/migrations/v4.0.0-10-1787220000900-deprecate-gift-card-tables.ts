import { MigrationInterface, QueryRunner } from 'typeorm';

// Step 6.17 (6B): tables of gift cards: cards, card orders, gift cards,
// recipients, coin policy, card order revenue and the gift card feature
// flags. The trigger trg_card_order_status_to_completed_after_update stays
// on the renamed card order table and still names card_order_revenue_tbl:
// nothing writes to the renamed table, and stage 10 drops both.
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
export class DeprecateGiftCardTables1787220000900
  implements MigrationInterface
{
  name = 'DeprecateGiftCardTables1787220000900';

  private readonly tables = [
    'card_order_revenue_tbl',
    'card_order_tbl',
    'card_tbl',
    'coin_policy_tbl',
    'feature_flag_tbl',
    'feature_group_tbl',
    'gift_card_tbl',
    'recipient_tbl',
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
