import { MigrationInterface, QueryRunner } from 'typeorm';

// Step 6.17 (6B): tables of orders and what hangs on them: order items,
// payments, invoices, tracking, kitchen (chef areas and orders), print jobs
// and printers, the ACB connector config and the order workflow.
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
export class DeprecateOrderTables1787220000500 implements MigrationInterface {
  name = 'DeprecateOrderTables1787220000500';

  private readonly tables = [
    'acb_connector_config_tbl',
    'chef_area_tbl',
    'chef_order_item_tbl',
    'chef_order_tbl',
    'invoice_area_tbl',
    'invoice_item_tbl',
    'invoice_tbl',
    'job_tbl',
    'order_item_tbl',
    'order_tbl',
    'payment_tbl',
    'printer_connector_tbl',
    'printer_event_tbl',
    'printer_job_tbl',
    'printer_tbl',
    'product_chef_area_tbl',
    'tracking_order_item_tbl',
    'tracking_tbl',
    'workflow_tbl',
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
