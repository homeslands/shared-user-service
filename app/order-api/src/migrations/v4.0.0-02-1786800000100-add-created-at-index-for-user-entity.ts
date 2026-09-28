import { MigrationInterface, QueryRunner } from 'typeorm';

// QD19 + QD21 (progress/shared-user.md giai doan 2, progress/trend-api.md
// A7-d): `POST /internal/users/list-recent` tro thanh duong dong bo user
// CHINH giua cac service, va no loc theo `created_at_column`:
//
//   - luoi nhanh ben trend:  moi 10 phut, cua so [now-30m, now]
//   - luoi rong ben trend:   1 lan/ngay, cua so [now-48h, now]
//   - sync-on-read:          toi da 1 lan/phut cho toan cum
//
// Khong co index thi moi 10 phut la mot luot QUET TOAN BANG user_tbl, va
// con nhan len theo so service tieu thu. Them index truoc khi bat cac job
// do len.
export class AddCreatedAtIndexForUserEntity1786800000100
  implements MigrationInterface
{
  name = 'AddCreatedAtIndexForUserEntity1786800000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX \`IDX_user_tbl_created_at_column\` ON \`user_tbl\` (\`created_at_column\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_user_tbl_created_at_column\` ON \`user_tbl\``,
    );
  }
}
