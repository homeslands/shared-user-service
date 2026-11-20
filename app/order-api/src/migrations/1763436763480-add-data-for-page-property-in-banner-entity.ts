// Step 6.17: src/banner/banner.constants.ts was removed with its module; the values this migration
// uses are copied here so it keeps doing the same thing on a fresh database.
const BannerPage = { HOME: 'home' } as const;
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDataForPagePropertyInBannerEntity1763436763480
  implements MigrationInterface
{
  name = 'AddDataForPagePropertyInBannerEntity1763436763480';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE banner_tbl SET page_column = '${BannerPage.HOME}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE banner_tbl SET page_column = NULL`);
  }
}
