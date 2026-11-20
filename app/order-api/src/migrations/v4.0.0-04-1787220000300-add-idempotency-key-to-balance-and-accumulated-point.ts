import { MigrationInterface, QueryRunner } from 'typeorm';

// Giai doan 6, buoc 6.3 (progress/buoc-trien-khai-gd2-10.md, shared-user.md
// 6A-1 buoc 2): cot khoa idempotent + UNIQUE cho ca bon bang vi. Do
// 08/09/2026 va lai 17/11/2026: chua bang nao co.
//
// `external_transaction_id_column` mang khoa ben goi gui sang, dang
// `<service>:<tham chieu>[:<nhip>[:<so thu tu>]]` (vd `trend:abc:add`,
// `terminal:abc:reserve:2`). UNIQUE tren TOAN chuoi, ke ca tien to service:
// `trend:abc:add` va `terminal:abc:add` la hai giao dich hop le.
//
// - `varchar(191)`: chi so unique khong vuot gioi han do dai cua utf8mb4.
//   Chi so tren ca cot, KHONG phai chi so tien to (`col(n)`).
// - `utf8mb4_bin`: so khop tung byte. Collation mac dinh cua bang
//   (`utf8mb4_0900_ai_ci`) khong phan biet hoa thuong / dau: hai khoa khac
//   nhau mot chu hoa se dung nhau va giao dich thu hai bi nuot nhu mot lan lap.
// - `NULL`: moi dong hien co va moi dong backfill 6.12 (nguon `trend_db` khong
//   co cot nay) de NULL; UNIQUE cua MySQL cho phep nhieu NULL, nen rang buoc
//   khong vap du lieu cu (quy dinh migration x script so 4).
//
// Vai tro tren tung bang:
// - `point_transaction_tbl`, `accumulated_point_transaction_history_tbl`
//   (so cai): khoa cua chinh giao dich; UNIQUE la hang rao chong ghi lap khi
//   ben goi gui lai sau timeout (hai replica goi cung luc: mot cai thang).
// - `balance_tbl`, `accumulated_point_tbl` (so du, mot dong mot nguoi): khoa
//   cua giao dich GHI SAU CUNG vao dong do, de doi chieu dong so du voi so cai.
//
// Chay lai duoc: bo qua cot / chi so da co. `down()` chi bo chi so UNIQUE, GIU
// cot: khoa da ghi la du lieu doi chieu, ma cu khong map cot nay.
const TABLES: { table: string; index: string }[] = [
  { table: 'balance_tbl', index: 'UQ_balance_external_transaction_id' },
  {
    table: 'point_transaction_tbl',
    index: 'UQ_point_transaction_external_transaction_id',
  },
  {
    table: 'accumulated_point_tbl',
    index: 'UQ_accumulated_point_external_transaction_id',
  },
  {
    table: 'accumulated_point_transaction_history_tbl',
    index: 'UQ_ap_history_external_transaction_id',
  },
];
const COLUMN = 'external_transaction_id_column';

export class AddIdempotencyKeyToBalanceAndAccumulatedPoint1787220000300
  implements MigrationInterface
{
  name = 'AddIdempotencyKeyToBalanceAndAccumulatedPoint1787220000300';

  private async has(
    q: QueryRunner,
    view: 'COLUMNS' | 'STATISTICS',
    table: string,
    name: string,
  ): Promise<boolean> {
    const field = view === 'COLUMNS' ? 'COLUMN_NAME' : 'INDEX_NAME';
    const rows = await q.query(
      `SELECT 1 FROM information_schema.${view}
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND ${field} = ?`,
      [table, name],
    );
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, index } of TABLES) {
      if (!(await this.has(queryRunner, 'COLUMNS', table, COLUMN))) {
        await queryRunner.query(
          `ALTER TABLE \`${table}\` ADD \`${COLUMN}\` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL`,
        );
      }
      if (!(await this.has(queryRunner, 'STATISTICS', table, index))) {
        await queryRunner.query(
          `CREATE UNIQUE INDEX \`${index}\` ON \`${table}\` (\`${COLUMN}\`)`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, index } of TABLES) {
      if (await this.has(queryRunner, 'STATISTICS', table, index)) {
        await queryRunner.query(`DROP INDEX \`${index}\` ON \`${table}\``);
      }
    }
  }
}
