import { MigrationInterface, QueryRunner } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { getRandomString } from 'src/helper';
// Step 6.17: src/payment/payment.constants.ts was removed with its module; the values this migration
// uses are copied here so it keeps doing the same thing on a fresh database.
const PaymentMethod = {
  BANK_TRANSFER: 'bank-transfer',
  CASH: 'cash',
  POINT: 'point',
  CREDIT_CARD: 'credit-card',
} as const;

export class InitVoucherPaymentMethodDataForExistedVoucher1756261512372
  implements MigrationInterface
{
  name = 'InitVoucherPaymentMethodDataForExistedVoucher1756261512372';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const cashPaymentMethod = PaymentMethod.CASH;
    const bankTransferPaymentMethod = PaymentMethod.BANK_TRANSFER;
    const pointPaymentMethod = PaymentMethod.POINT;

    const vouchers = await queryRunner.query(`
        SELECT id_column FROM voucher_tbl where deleted_at_column is null
      `);

    for (const voucher of vouchers) {
      const voucherId = voucher.id_column;
      await queryRunner.query(
        `
            INSERT INTO voucher_payment_method_tbl (id_column, slug_column, voucher_column, payment_method_column)
            VALUES (?, ?, ?, ?)
            `,
        [uuidv4(), getRandomString(), voucherId, cashPaymentMethod],
      );

      await queryRunner.query(
        `
            INSERT INTO voucher_payment_method_tbl (id_column, slug_column, voucher_column, payment_method_column)
            VALUES (?, ?, ?, ?)
            `,
        [uuidv4(), getRandomString(), voucherId, bankTransferPaymentMethod],
      );

      await queryRunner.query(
        `
            INSERT INTO voucher_payment_method_tbl (id_column, slug_column, voucher_column, payment_method_column)
            VALUES (?, ?, ?, ?)
            `,
        [uuidv4(), getRandomString(), voucherId, pointPaymentMethod],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const cashPaymentMethod = PaymentMethod.CASH;
    const bankTransferPaymentMethod = PaymentMethod.BANK_TRANSFER;
    const pointPaymentMethod = PaymentMethod.POINT;

    await queryRunner.query(`
        DELETE FROM voucher_payment_method_tbl WHERE payment_method_column IN ('${cashPaymentMethod}', '${bankTransferPaymentMethod}', '${pointPaymentMethod}');
      `);
  }
}
