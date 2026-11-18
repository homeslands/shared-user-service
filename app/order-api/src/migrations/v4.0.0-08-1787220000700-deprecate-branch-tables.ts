import { MigrationInterface, QueryRunner } from 'typeorm';

// Step 6.17 (6B): tables of branches: branch, branch config, branch revenue,
// revenue and addresses. user_tbl.branch_id_column keeps its foreign key,
// which follows the renamed table.
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
export class DeprecateBranchTables1787220000700 implements MigrationInterface {
  name = 'DeprecateBranchTables1787220000700';

  private readonly tables = [
    'address_tbl',
    'branch_config_tbl',
    'branch_revenue_tbl',
    'branch_tbl',
    'revenue_tbl',
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
