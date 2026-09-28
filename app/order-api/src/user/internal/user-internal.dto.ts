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
