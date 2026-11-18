// Step 6.17: src/voucher/voucher.constant.ts was removed with its module; the values this migration
// uses are copied here so it keeps doing the same thing on a fresh database.
const VoucherCustomerType = { ALL: 'all', GROUP: 'group' } as const;
import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateDataForCustomerTypeInVoucherEntity1764578522404
  implements MigrationInterface
{
  name = 'MigrateDataForCustomerTypeInVoucherEntity1764578522404';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE voucher_tbl SET customer_type_column = '${VoucherCustomerType.ALL}' WHERE is_user_group_column = false
    `);

    await queryRunner.query(`
      UPDATE voucher_tbl SET customer_type_column = '${VoucherCustomerType.GROUP}' WHERE is_user_group_column = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE voucher_tbl SET customer_type_column = NULL WHERE customer_type_column IS NOT NULL
    `);
  }
}
