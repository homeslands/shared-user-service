import { MigrationInterface, QueryRunner } from 'typeorm';

// Giai doan 6, buoc 6.4 (progress/buoc-trien-khai-gd2-10.md, QD-T3 chot
// 17/11/2026): bat bien "mot nguoi mot giu cho" o tang DB, theo
// (nguoi, service), va cot han giu cho `expires_at_column` (QD11).
//
// Hom nay bat bien chi la mot cau `findOne` trong
// AccumulatedPointService.reservePointsForOrder: hai request song song cung doc
// "chua co" roi cung ghi. MySQL khong co partial index, nen dung cot sinh:
//
// - `active_reservation_key_column` (STORED) = NULL khi dong KHONG phai giu
//   cho dang hieu luc; khi phai (type `reserve`, status `pending`, chua xoa
//   mem, co `accumulated_point_column`) thi bang
//   `<accumulated_point_column>:<service>`.
// - UNIQUE tren cot do: moi (nguoi, service) toi da mot giu cho dang hieu luc.
//   MySQL cho nhieu NULL trong UNIQUE, nen moi dong khac khong bi rang buoc.
//
// Service lay tu tien to cua khoa idempotent (`<service>:<tham chieu>:...`,
// buoc 6.3) neu co, khong thi tu tien to cua tham chieu mem
// `object_slug_column` (`<service>:<orderSlug>`, buoc 6.2) - dong cu va dong
// backfill 6.12 khong co khoa. Bieu thuc khong nhac ten consumer nao: vi
// khong biet ai goi no. Hai service khac nhau thi hai khoa khac nhau, nen mot
// khach dang giu diem o service nay van giu duoc o service kia (QD-T3); dieu
// kien "tong - dang giu >= so xin giu" van dung vi `reserve` tru thang
// `total_points` luc giu cho (so du kha dung da la tong - dang giu).
//
// - `deleted_at_column IS NULL`: TypeORM khong doc dong da xoa mem, nen mot
//   giu cho bi xoa mem ma DB van tinh thi nguoi do bi chan mai mai.
// - So khop byte (`utf8mb4_bin`) nhu khoa 6.3.
// - Do 17/11/2026 truoc khi dat UNIQUE: 0 dong `reserve`/`pending` o trend_db,
//   trend_test_db, terminal_db, shared_user_db, shared_user_test_db.
//
// `expires_at_column` timestamp(6) NULL: han cua dong giu cho, ben goi gui qua
// route noi bo (6.7); job 6.8 nha dong `reserve`/`pending` da qua han. NULL =
// khong co han (dong cu, va dong ghi qua duong ban sao hien co). Chi so de job
// quet theo han.
//
// Chay lai duoc: bo qua cot / chi so da co; dung neu da co nguoi giu hai cho
// cung service (in danh sach). `down()` bo UNIQUE, chi so han va cot sinh (cot
// sinh tinh lai duoc tu cac cot khac, khong mat du lieu); GIU
// `expires_at_column` vi han da ghi la du lieu.
const TABLE = 'accumulated_point_transaction_history_tbl';
const KEY_COLUMN = 'active_reservation_key_column';
const KEY_INDEX = 'UQ_ap_history_active_reservation';
const EXPIRES_COLUMN = 'expires_at_column';
const EXPIRES_INDEX = 'IDX_ap_history_expires_at';

const SERVICE_OF_ROW = `COALESCE(SUBSTRING_INDEX(external_transaction_id_column, ':', 1), SUBSTRING_INDEX(object_slug_column, ':', 1), '')`;
const KEY_EXPRESSION =
  `CASE WHEN type_column = 'reserve' AND status_column = 'pending'` +
  ` AND deleted_at_column IS NULL AND accumulated_point_column IS NOT NULL` +
  ` THEN CONCAT(accumulated_point_column, ':', ${SERVICE_OF_ROW}) END`;

export class AddActiveReservationInvariantToAccumulatedPointHistory1787220000400
  implements MigrationInterface
{
  name = 'AddActiveReservationInvariantToAccumulatedPointHistory1787220000400';

  private async has(
    q: QueryRunner,
    view: 'COLUMNS' | 'STATISTICS',
    name: string,
  ): Promise<boolean> {
    const field = view === 'COLUMNS' ? 'COLUMN_NAME' : 'INDEX_NAME';
    const rows = await q.query(
      `SELECT 1 FROM information_schema.${view}
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND ${field} = ?`,
      [TABLE, name],
    );
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.has(queryRunner, 'COLUMNS', EXPIRES_COLUMN))) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\` ADD \`${EXPIRES_COLUMN}\` timestamp(6) NULL`,
      );
    }
    if (!(await this.has(queryRunner, 'STATISTICS', EXPIRES_INDEX))) {
      await queryRunner.query(
        `CREATE INDEX \`${EXPIRES_INDEX}\` ON \`${TABLE}\` (\`${EXPIRES_COLUMN}\`)`,
      );
    }

    if (!(await this.has(queryRunner, 'COLUMNS', KEY_COLUMN))) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\` ADD \`${KEY_COLUMN}\` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` +
          ` GENERATED ALWAYS AS (${KEY_EXPRESSION}) STORED NULL`,
      );
    }
    if (!(await this.has(queryRunner, 'STATISTICS', KEY_INDEX))) {
      const duplicated: { k: string; n: string }[] = await queryRunner.query(
        `SELECT \`${KEY_COLUMN}\` AS k, COUNT(*) AS n FROM \`${TABLE}\`
          WHERE \`${KEY_COLUMN}\` IS NOT NULL
          GROUP BY \`${KEY_COLUMN}\` HAVING COUNT(*) > 1`,
      );
      if (duplicated.length > 0) {
        throw new Error(
          `${TABLE}: ${duplicated.length} (accumulated point, service) pair(s) hold more than one pending reservation, ` +
            `resolve them before the unique index: ${duplicated
              .map((d) => `${d.k} x${d.n}`)
              .join(', ')}`,
        );
      }
      await queryRunner.query(
        `CREATE UNIQUE INDEX \`${KEY_INDEX}\` ON \`${TABLE}\` (\`${KEY_COLUMN}\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.has(queryRunner, 'STATISTICS', KEY_INDEX)) {
      await queryRunner.query(`DROP INDEX \`${KEY_INDEX}\` ON \`${TABLE}\``);
    }
    if (await this.has(queryRunner, 'COLUMNS', KEY_COLUMN)) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\` DROP COLUMN \`${KEY_COLUMN}\``,
      );
    }
    if (await this.has(queryRunner, 'STATISTICS', EXPIRES_INDEX)) {
      await queryRunner.query(
        `DROP INDEX \`${EXPIRES_INDEX}\` ON \`${TABLE}\``,
      );
    }
  }
}
