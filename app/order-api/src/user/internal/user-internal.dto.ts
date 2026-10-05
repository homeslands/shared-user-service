import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsInt,
  Min,
  Max,
  IsString,
  IsDateString,
} from 'class-validator';
import { INTERNAL_LIST_RECENT_MAX_LIMIT } from 'src/common/constants/internal-api.constant';

// DTO RIENG cho POST /internal/users - co tinh KHONG dung lai
// CreateUserRequestDto cua route client-facing POST /user. Hai ly do:
//
// 1. Route noi bo KHONG nhan `role` (QD15): hai he phan quyen doc lap, ben
//    goi khong duoc quyet role cua shared-user. shared-user tu gan role mac
//    dinh cua chinh no.
// 2. Route noi bo BAT BUOC co `isShared` (QD18), con route client-facing thi
//    khong. Nhet ca hai vao mot DTO la noi long validate cua endpoint nay de
//    phuc vu endpoint kia.
export class CreateInternalUserRequestDto {
  @ApiProperty()
  @IsNotEmpty({ message: 'phonenumber is required' })
  phonenumber: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'password is required' })
  password: string;

  @ApiProperty({ required: false })
  @IsOptional()
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  lastName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(/^(0[1-9]|[12]\d|3[0-1])\/(0[1-9]|1[0-2])\/(19|20)\d{2}$/, {
    message: 'Invalid day of birth format dd/mm/yyyy',
  })
  dob?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isVerifiedPhonenumber?: boolean;

  // QD18 - BAT BUOC, khong optional. Mot ben goi quen gui thi phai hong ON
  // AO (400) chu khong duoc gan mac dinh IM LANG: cot owner_service la cot
  // BAT BIEN, gan sai mot lo la khong sua duoc bang nghiep vu.
  //
  //   true  => owner_service = NULL       (tai khoan dung chung - khach)
  //   false => owner_service = ten service goi (lay tu header noi bo,
  //            KHONG lay tu body - de mot service khong khai duoc hang
  //            thuoc ve service khac)
  @ApiProperty()
  @IsNotEmpty({ message: 'isShared is required' })
  @IsBoolean({ message: 'isShared must be a boolean' })
  isShared: boolean;
}

// Chuoi bcrypt day du: `$2a$`/`$2b$`/`$2y$` + cost 2 chu so + 53 ky tu
// (22 salt + 31 hash). Kiem DINH DANG chu khong kiem cost: bcrypt.compare doc
// cost/salt tu chinh chuoi hash, nen hash sinh voi SALT_ROUNDS khac van dang
// nhap duoc.
export const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// DTO RIENG cho POST /internal/users/import - NHAP MOT LAN tai khoan da co
// tu truoc o service tieu thu (vd nhan vien terminal truoc khi terminal noi
// vao shared-user). Khac CreateInternalUserRequestDto o cho:
//
// - Nhan `passwordHash` (da bam), KHONG nhan mat khau tho: route nay chuyen
//   nguyen tai khoan cu sang, nguoi dung dang nhap duoc bang mat khau cu.
//   Bo trong => shared-user sinh mot hash ngau nhien khong ai biet, nguoi do
//   chi vao duoc sau khi dat lai mat khau (QD16).
// - Nhan them `email`/`isActive`/`createdAt`/... - nhung thu route tao moi
//   khong can vi tai khoan moi khong co lich su.
//
// Van KHONG nhan `role` (QD15) va van BAT BUOC `isShared` (QD18).
export class ImportInternalUserRequestDto {
  @ApiProperty()
  @IsNotEmpty({ message: 'phonenumber is required' })
  @IsString()
  phonenumber: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(BCRYPT_HASH_PATTERN, {
    message: 'passwordHash must be a bcrypt hash',
  })
  passwordHash?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  // Khong ep dinh dang: day la du lieu CU cua service khac, tu choi vi dinh
  // dang la de mot tai khoan that bi bo lai. Email trung thi bao 409.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  email?: string;

  // Cung ly do tren - khong ep dd/mm/yyyy. `dobDM` chi duoc suy ra khi chuoi
  // dung dinh dang do.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  dob?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  image?: string;

  // BAT BUOC, khong mac dinh `true`: tai khoan dang bi khoa ben kia ma sang
  // day thanh mo khoa la mo cua cho mot nguoi da bi chan.
  @ApiProperty()
  @IsNotEmpty({ message: 'isActive is required' })
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isVerifiedPhonenumber?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isVerifiedEmail?: boolean;

  // Ngay tao THAT ben service cu. Bo trong => gio nhap.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString({}, { message: 'createdAt must be an ISO date string' })
  createdAt?: string;

  // QD18 - xem CreateInternalUserRequestDto.isShared.
  @ApiProperty()
  @IsNotEmpty({ message: 'isShared is required' })
  @IsBoolean({ message: 'isShared must be a boolean' })
  isShared: boolean;
}

export class LookupUserRequestDto {
  @IsOptional()
  @IsString()
  phonenumber?: string;

  @IsOptional()
  @IsString()
  id?: string;
}

export class ListRecentUserRequestDto {
  @IsDateString({}, { message: 'createdFrom must be an ISO date string' })
  createdFrom: string;

  @IsDateString({}, { message: 'createdTo must be an ISO date string' })
  createdTo: string;

  // QD21 - phan trang BAT BUOC cho luoi rong (cua so 48 gio co the la vai
  // nghin hang sau mot dot su co). Ben goi lap cho toi khi tra ve it hon
  // `limit`.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INTERNAL_LIST_RECENT_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ToggleActiveUserRequestDto {
  // Nhan gia tri dich, KHONG tu dao - goi lai hai lan phai ra cung mot ket
  // qua (idempotent).
  @IsNotEmpty({ message: 'isActive is required' })
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive: boolean;
}
