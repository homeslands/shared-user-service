import { MigrationInterface, QueryRunner } from 'typeorm';

// Giai doan 6, buoc 6.2 (progress/buoc-trien-khai-gd2-10.md, shared-user.md
// 6A-1 buoc 1): bang lich su diem bo khoa ngoai `order_column` -> `order_tbl`.
//
// `Order` thuoc service goi (trend, terminal), khong thuoc shared-user: buoc
// 6.17 xoa `order/` va doi ten `order_tbl`, nen khoa ngoai xuyen ranh gioi nay
// phai di truoc. Thay bang THAM CHIEU MEM, cung mau `point_transaction_tbl`:
//
//   object_type_column = 'ORDER'
//   object_id_column   = id cua don o service sinh ra no
//   object_slug_column = '<service>:<orderSlug>'  (vd `trend:abc`, `terminal:abc`)
//
// Ca ba la `varchar(255) NULL`, KHONG gia dinh tien to `trend:` (do dai, rang
// buoc, chi so): dong `terminal:<orderSlug>` se nam cung bang.
//
// Cac buoc, dung thu tu:
//   1. them ba cot (bo qua cot da co -> chay lai duoc sau mot lan hong giua
//      chung, vi DDL cua MySQL tu commit);
//   2. backfill tu `order_column`, JOIN `order_tbl` KHI NO CON TON TAI. Moi
//      dong trong shared_user_db den tu ban sao mono, tuc la don cua trend
//      -> tien to `trend:`. Gan lai `updated_at_column` bang chinh no: cot co
//      ON UPDATE, khong gan thi moi dong lich su mang moc gio chay migration;
//   3. kiem: dong nao co `order_column` ma `object_slug_column` rong thi DUNG
//      (khong bo khoa ngoai khi tham chieu mem chua du);
//   4. `DROP FOREIGN KEY` - ten khoa do qua information_schema, khong chep
//      cung ten TypeORM sinh;
//   5. doi ten `order_column` -> `_deprecated_order_column` (KHONG `DROP
//      COLUMN`: drop that o giai doan 10, dot phat hanh rieng). Chi so cu tren
//      cot di theo cot;
//   6. chi so tren `object_id_column` (ma hien tai tra giu cho theo id don) va
//      `object_slug_column` (route noi bo 6.7 tra theo tham chieu).
const TABLE = 'accumulated_point_transaction_history_tbl';

export class SoftRefOrderForAccumulatedPointHistory1787220000200
  implements MigrationInterface
{
  name = 'SoftRefOrderForAccumulatedPointHistory1787220000200';

  private async hasColumn(q: QueryRunner, column: string): Promise<boolean> {
    const rows = await q.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [TABLE, column],
    );
    return rows.length > 0;
  }

  private async hasIndex(q: QueryRunner, index: string): Promise<boolean> {
    const rows = await q.query(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [TABLE, index],
    );
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ba cot tham chieu mem
    for (const column of [
      'object_id_column',
      'object_type_column',
      'object_slug_column',
    ]) {
      if (!(await this.hasColumn(queryRunner, column))) {
        await queryRunner.query(
          `ALTER TABLE \`${TABLE}\` ADD \`${column}\` varchar(255) NULL`,
        );
      }
    }

    const orderColumn = (await this.hasColumn(queryRunner, 'order_column'))
      ? 'order_column'
      : '_deprecated_order_column';

    // 2. Backfill tu order_tbl (chi dong chua co tham chieu mem)
    await queryRunner.query(
      `UPDATE \`${TABLE}\` h
         JOIN \`order_tbl\` o ON o.\`id_column\` = h.\`${orderColumn}\`
          SET h.\`updated_at_column\`  = h.\`updated_at_column\`,
              h.\`object_type_column\` = 'ORDER',
              h.\`object_id_column\`   = o.\`id_column\`,
              h.\`object_slug_column\` = CONCAT('trend:', o.\`slug_column\`)
        WHERE h.\`object_slug_column\` IS NULL`,
    );

    // 3. Khong bo khoa ngoai khi con dong co don ma thieu tham chieu mem
    const [{ missing }] = await queryRunner.query(
      `SELECT COUNT(*) AS missing FROM \`${TABLE}\`
        WHERE \`${orderColumn}\` IS NOT NULL AND \`object_slug_column\` IS NULL`,
    );
    if (Number(missing) > 0) {
      throw new Error(
        `${TABLE}: ${missing} dong co ${orderColumn} nhung chua co object_slug_column - dung truoc khi bo khoa ngoai`,
      );
    }

    // 4. Bo moi khoa ngoai tu bang nay sang order_tbl
    const fks: { name: string }[] = await queryRunner.query(
      `SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          AND REFERENCED_TABLE_NAME = 'order_tbl'`,
      [TABLE],
    );
    for (const fk of fks) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\` DROP FOREIGN KEY \`${fk.name}\``,
      );
    }

    // 5. Doi ten, khong xoa
    if (orderColumn === 'order_column') {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\` RENAME COLUMN \`order_column\` TO \`_deprecated_order_column\``,
      );
    }

    // 6. Chi so cho tham chieu mem
    if (!(await this.hasIndex(queryRunner, 'IDX_ap_history_object_id'))) {
      await queryRunner.query(
        `CREATE INDEX \`IDX_ap_history_object_id\` ON \`${TABLE}\` (\`object_id_column\`)`,
      );
    }
    if (!(await this.hasIndex(queryRunner, 'IDX_ap_history_object_slug'))) {
      await queryRunner.query(
        `CREATE INDEX \`IDX_ap_history_object_slug\` ON \`${TABLE}\` (\`object_slug_column\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_ap_history_object_slug\` ON \`${TABLE}\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_ap_history_object_id\` ON \`${TABLE}\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`${TABLE}\` RENAME COLUMN \`_deprecated_order_column\` TO \`order_column\``,
    );
    // Dong ghi sau buoc nay chi co tham chieu mem: tra order_column tu
    // object_id_column khi don con trong order_tbl, roi moi dung lai khoa ngoai.
    await queryRunner.query(
      `UPDATE \`${TABLE}\` h
         JOIN \`order_tbl\` o ON o.\`id_column\` = h.\`object_id_column\`
          SET h.\`updated_at_column\` = h.\`updated_at_column\`,
              h.\`order_column\` = o.\`id_column\`
        WHERE h.\`order_column\` IS NULL AND h.\`object_type_column\` = 'ORDER'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`${TABLE}\` ADD CONSTRAINT \`FK_0751b591841b128a7f5814c27b1\`
         FOREIGN KEY (\`order_column\`) REFERENCES \`order_tbl\`(\`id_column\`)
         ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // GIU ba cot tham chieu mem (khong xoa cot): dong ghi sau buoc nay ma
    // don khong nam trong order_tbl (vd `terminal:<orderSlug>`) chi co tham
    // chieu o day. Ma cu khong map ba cot nay; `up` chay lai thi bo qua cot da
    // co va chi backfill dong con rong.
  }
}
