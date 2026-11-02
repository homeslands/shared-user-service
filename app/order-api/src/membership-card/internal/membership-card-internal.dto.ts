import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// QD22 - hop dong cua /internal/membership-cards/* (architect-http.md muc
// 4.2). Ben goi la order service (trend, terminal): quyen phat/khoa/thay the
// kiem o do bang role cua no (khuon QD16), shared-user chi THI HANH.

// POST /internal/membership-cards/bulk-issue - KHONG nhan `userGroup`: nhom
// khach o lai order service, ben goi tu them thanh vien sau (QD22.b).
export class BulkIssueMembershipCardRequestDto {
  @IsArray({ message: 'codes must be an array' })
  @ArrayNotEmpty({ message: 'codes must not be empty' })
  @IsString({ each: true, message: 'each code must be a string' })
  codes: string[];

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expiredAt must be a date' })
  expiredAt?: Date;
}

// POST /internal/membership-cards - gan mot the cho mot nguoi da co.
export class AssignMembershipCardRequestDto {
  @IsNotEmpty({ message: 'userId is required' })
  @IsString()
  userId: string;

  @IsNotEmpty({ message: 'code is required' })
  @IsString()
  code: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expiredAt must be a date' })
  expiredAt?: Date;
}

// POST /internal/membership-cards/lookup - DUNG MOT trong ba: `code` (quet the
// o quay, loc khach theo ma the - QD22.a), `userId` (the cua mot nguoi), hoac
// `userIds` (ghep field `membershipCard` cho ca mot trang danh sach).
//
// Khoa co mat thi KHONG duoc rong: `@IsOptional` chi bo qua undefined/null,
// chuoi rong van lot qua `@IsString` va tung khop the dau bang (do 25/10/2026 -
// cung loai loi buoc 2.3 va o `findOneByField`). Rong => 400.
export class LookupMembershipCardRequestDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'code must not be empty' })
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'userId must not be empty' })
  userId?: string;

  @IsOptional()
  @IsArray({ message: 'userIds must be an array' })
  @IsString({ each: true, message: 'each userId must be a string' })
  userIds?: string[];
}

// POST /internal/membership-cards/:id/toggle-active - nhan trang thai DICH,
// khong tu dao: goi lai hai lan khong ra hai ket qua khac nhau.
export class ToggleActiveMembershipCardRequestDto {
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive: boolean;
}

// POST /internal/membership-cards/replace - thay the cu bang ma moi cho cung
// nguoi, mot transaction.
export class ReplaceMembershipCardRequestDto {
  @IsNotEmpty({ message: 'userId is required' })
  @IsString()
  userId: string;

  @IsNotEmpty({ message: 'code is required' })
  @IsString()
  code: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expiredAt must be a date' })
  expiredAt?: Date;
}
