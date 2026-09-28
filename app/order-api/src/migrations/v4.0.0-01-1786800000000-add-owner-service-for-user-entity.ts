import { MigrationInterface, QueryRunner } from 'typeorm';

// QD18 (progress/trend-api.md A3.1, progress/shared-user.md giai doan 2):
// phan biet danh tinh DUNG CHUNG voi danh tinh RIENG cua mot service.
//
//   owner_service_column IS NULL  = tai khoan dung chung (khach) - moi
//                                   service tieu thu duoc tu cap hang cuc bo
//   owner_service_column = 'trend' = rieng cua trend (nhan vien, hang he
//                                   thong) - service khac khong duoc tu cap
//                                   hang cuc bo cho ho
//
// Sentinel "khach vang lai" (DEFAULT_CUSTOMER_SHARED_ID) de NULL: no la khach
// DUNG CHUNG cap toan cum - moi service ban tai quay dung lai dung hang do,
// nhan dien bang id (isDefaultCustomer), khong bang cot nay.
//
// COT BAT BIEN: da co gia tri thi khong doi, khong co duong thang
// 'trend' -> NULL. Vi the down() phai drop duoc cot - mot luot backfill sai
// khong sua duoc bang nghiep vu, chi sua duoc bang mot migration khac.
//
// THU TU BAT BUOC: migration nay phai chay TRUOC khi POST /internal/users
// bo nhan `role`. Backfill duoi day phan loai BANG CHINH cot role_column -
// sau khi route noi bo tu gan role mac dinh, cot do ngung phan anh thuc te
// va tin hieu phan loai bien mat.
//
// BAT DOI XUNG LOI - nghi ngo thi de NULL: danh thua (nhan vien de NULL) la
// vo hai, ho dung service khac NHU KHACH. Danh thieu (khach that bi gan
// 'trend') la khach mat quyen dung service khac VINH VIEN.
export class AddOwnerServiceForUserEntity1786800000000
  implements MigrationInterface
{
  name = 'AddOwnerServiceForUserEntity1786800000000';

  private readonly OWNER_SERVICE_TREND = 'trend';
  private readonly CUSTOMER_ROLE_NAME = 'CUSTOMER';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`user_tbl\` ADD \`owner_service_column\` varchar(64) NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_user_tbl_owner_service_column\` ON \`user_tbl\` (\`owner_service_column\`)`,
    );

    // (1) Moi hang co role KHAC Customer => rieng cua trend.
    //     Hang role NULL co tinh KHONG dinh vao day (huong lanh - de NULL).
    await queryRunner.query(
      `UPDATE \`user_tbl\` u
       JOIN \`role_tbl\` r ON r.id_column = u.role_column
       SET u.owner_service_column = ?
       WHERE r.name_column <> ?`,
      [this.OWNER_SERVICE_TREND, this.CUSTOMER_ROLE_NAME],
    );

    // (2) Hang role Customer (ke ca sentinel khach vang lai) va hang role
    //     NULL: de NULL - khong lam gi.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_user_tbl_owner_service_column\` ON \`user_tbl\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_tbl\` DROP COLUMN \`owner_service_column\``,
    );
  }
}
