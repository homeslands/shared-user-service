import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { AccumulatedPointResponseDto } from 'src/accumulated-point/accumulated-point.dto';
import { BaseQueryDto, BaseResponseDto } from 'src/app/base.dto';
import {
  // INVALID_FIRSTNAME,
  // INVALID_LASTNAME,
  INVALID_PASSWORD,
  INVALID_PHONENUMBER,
  INVALID_USERID,
} from 'src/auth/auth.validation';
import { BranchResponseDto } from 'src/branch/branch.dto';
import { RoleResponseDto } from 'src/role/role.dto';
import { INVALID_LANGUAGE } from './user.validation';
import {
  AccountRevenueCustomerType,
  UserLanguage,
  UserStatisticsGroupBy,
} from './user.constant';
import { MembershipCardResponseDto } from 'src/membership-card/membership-card.dto';
import { PaymentMethod } from 'src/payment/payment.constants';
import { Matches } from 'class-validator';

export class CreateUserRequestDto {
  @ApiProperty()
  @IsNotEmpty({ message: INVALID_PHONENUMBER })
  @AutoMap()
  phonenumber: string;

  @ApiProperty()
  @IsNotEmpty({ message: INVALID_PASSWORD })
  password: string;

  @ApiProperty()
  // @IsNotEmpty({ message: INVALID_FIRSTNAME })
  @IsOptional()
  @AutoMap()
  firstName: string;

  @ApiProperty()
  // @IsNotEmpty({ message: INVALID_LASTNAME })
  @IsOptional()
  @AutoMap()
  lastName: string;

  @ApiProperty()
  @IsOptional()
  branch?: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'Invalid role' })
  role: string;

  @ApiProperty()
  @IsOptional()
  @Matches(/^(0[1-9]|[12]\d|3[0-1])\/(0[1-9]|1[0-2])\/(19|20)\d{2}$/, {
    message: 'Invalid day of birth format dd/mm/yyyy',
  })
  @AutoMap()
  dob?: string;

  @ApiProperty()
  @IsOptional()
  isVerifiedPhonenumber?: boolean;
}

export class UserScopeDto {
  role: string;
  permissions: string[];
}

export class CurrentUserDto {
  @IsNotEmpty({ message: INVALID_USERID })
  userId: string;

  @IsOptional()
  scope?: UserScopeDto;
}

export class UserResponseDto extends BaseResponseDto {
  @ApiProperty()
  @AutoMap()
  readonly phonenumber: string;

  @ApiProperty()
  @AutoMap()
  readonly firstName?: string;

  @ApiProperty()
  @AutoMap()
  readonly lastName?: string;

  @AutoMap()
  @ApiProperty()
  readonly dob: string;

  @AutoMap()
  @ApiProperty()
  readonly email?: string;

  @AutoMap()
  @ApiProperty()
  readonly address: string;

  @AutoMap(() => BranchResponseDto)
  @ApiProperty({ type: () => BranchResponseDto })
  readonly branch: BranchResponseDto;

  @AutoMap(() => RoleResponseDto)
  @ApiProperty()
  role: RoleResponseDto;

  @AutoMap()
  @ApiProperty()
  isVerifiedEmail: boolean;

  @AutoMap()
  @ApiProperty()
  isVerifiedPhonenumber: boolean;

  @AutoMap(() => AccumulatedPointResponseDto)
  @ApiProperty()
  accumulatedPoint: AccumulatedPointResponseDto;

  @AutoMap()
  isActive: boolean;

  @AutoMap()
  language: string;

  @AutoMap(() => MembershipCardResponseDto)
  @ApiProperty({ type: () => MembershipCardResponseDto })
  membershipCard: MembershipCardResponseDto;

  @AutoMap(() => UserRequirementResponseDto)
  @ApiProperty({ type: () => UserRequirementResponseDto })
  userRequirements: UserRequirementResponseDto[];
}

export class GeneralUserResponseDto extends BaseResponseDto {
  @ApiProperty()
  @AutoMap()
  readonly phonenumber: string;

  @ApiProperty()
  @AutoMap()
  readonly firstName: string;

  @ApiProperty()
  @AutoMap()
  readonly lastName: string;
}

export class UpdateUserRoleRequestDto {
  @ApiProperty()
  @IsNotEmpty()
  role: string;
}

export class UpdateUserRequestDto {
  @ApiProperty()
  // @IsNotEmpty({ message: INVALID_FIRSTNAME })
  @IsOptional()
  firstName: string;

  @ApiProperty()
  // @IsNotEmpty({ message: INVALID_LASTNAME })
  @IsOptional()
  lastName: string;

  @IsOptional()
  @Matches(/^(0[1-9]|[12]\d|3[0-1])\/(0[1-9]|1[0-2])\/(19|20)\d{2}$/, {
    message: 'Invalid day of birth format dd/mm/yyyy',
  })
  @ApiProperty({ example: '01/01/1990' })
  // @IsNotEmpty({ message: INVALID_DOB })
  dob?: string;

  @ApiProperty()
  @IsOptional()
  email?: string;

  @ApiProperty()
  @IsOptional()
  address?: string;

  @ApiProperty()
  @IsOptional()
  branch?: string;
}

export class CompleteUserRegistrationRequestDto {
  @ApiProperty()
  @IsNotEmpty({ message: INVALID_PHONENUMBER })
  @AutoMap()
  phonenumber: string;

  // @ApiProperty()
  // @IsNotEmpty({ message: INVALID_PASSWORD })
  // password: string;
}

export class GetAllUserQueryRequestDto extends BaseQueryDto {
  @AutoMap()
  @ApiProperty({
    description: 'The slug of branch',
    example: '',
    required: false,
  })
  @IsOptional()
  branch?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  phonenumber: string;

  @ApiProperty({
    description: 'The slug of user',
    example: '',
    required: false,
  })
  @IsOptional()
  slug?: string;

  @ApiProperty({
    description: 'The code of membership card',
    example: '',
    required: false,
  })
  @IsOptional()
  membershipCard?: string;

  @AutoMap()
  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : [value],
  )
  role: string[] = [];

  @AutoMap()
  @ApiProperty({
    description: 'Enable paging',
    required: false,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return true; // Default true
    return value === 'true'; // Transform 'true' to `true` and others to `false`
  })
  hasPaging?: boolean;

  @ApiProperty({
    description:
      'Filter users created from this date (giờ địa phương, format: YYYY-MM-DDTHH:mm:ss)',
    example: '2024-01-01T00:00:00',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, {
    message: 'Format: YYYY-MM-DDTHH:mm:ss (local time, no timezone)',
  })
  startDate?: string;

  @ApiProperty({
    description:
      'Filter users created up to this date (giờ địa phương, format: YYYY-MM-DDTHH:mm:ss)',
    example: '2024-12-31T23:59:59',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, {
    message: 'Format: YYYY-MM-DDTHH:mm:ss (local time, no timezone)',
  })
  endDate?: string;
}

export class GetUserStatisticsQueryRequestDto {
  @ApiProperty({
    description: 'Start date (giờ địa phương, format: YYYY-MM-DDTHH:mm:ss)',
    example: '2024-01-01T00:00:00',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, {
    message: 'Format: YYYY-MM-DDTHH:mm:ss (local time, no timezone)',
  })
  startDate?: string;

  @ApiProperty({
    description: 'End date (giờ địa phương, format: YYYY-MM-DDTHH:mm:ss)',
    example: '2024-12-31T23:59:59',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, {
    message: 'Format: YYYY-MM-DDTHH:mm:ss (local time, no timezone)',
  })
  endDate?: string;

  @ApiProperty({
    description: 'Time grouping unit',
    enum: UserStatisticsGroupBy,
    default: UserStatisticsGroupBy.DAY,
    required: false,
  })
  @IsOptional()
  @IsEnum(UserStatisticsGroupBy)
  @Type(() => String)
  groupBy?: UserStatisticsGroupBy = UserStatisticsGroupBy.DAY;
}

export class UserStatisticItemDto {
  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  time: string;

  @ApiProperty({ example: 5 })
  count: number;
}

export class UserStatisticsResponseDto {
  @ApiProperty({ type: () => [UserStatisticItemDto] })
  data: UserStatisticItemDto[];

  @ApiProperty({ example: 100 })
  total: number;
}

export class UpdateUserLanguageRequestDto {
  @ApiProperty()
  @IsNotEmpty({ message: INVALID_LANGUAGE })
  @IsEnum(UserLanguage, { message: INVALID_LANGUAGE })
  language: string;
}

export class UserRequirementResponseDto extends BaseResponseDto {
  @AutoMap()
  @ApiProperty()
  key: string;

  @AutoMap()
  @ApiProperty()
  status: string;

  @AutoMap()
  @ApiProperty()
  level: string;

  @AutoMap()
  @ApiProperty()
  scope: string;

  @AutoMap()
  @ApiProperty()
  expiredAt: string;

  @AutoMap()
  @ApiProperty()
  lastUpdatedAt: string;
}

export class GetAccountRevenueQueryDto {
  @AutoMap()
  @ApiProperty({ required: true, example: 'branch-slug' })
  @IsNotEmpty({ message: 'Branch slug is not empty' })
  branch: string;

  @AutoMap()
  @ApiProperty({
    description: 'Start date (giờ địa phương, format: YYYY-MM-DDTHH:mm:ss)',
    example: '2024-01-01T00:00:00',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, {
    message: 'Format: YYYY-MM-DDTHH:mm:ss (local time, no timezone)',
  })
  startDate?: string;

  @AutoMap()
  @ApiProperty({
    description: 'End date (giờ địa phương, format: YYYY-MM-DDTHH:mm:ss)',
    example: '2024-12-31T23:59:59',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, {
    message: 'Format: YYYY-MM-DDTHH:mm:ss (local time, no timezone)',
  })
  endDate?: string;

  @AutoMap()
  @ApiProperty({
    required: false,
    example: PaymentMethod.CASH,
    enum: Object.values(PaymentMethod),
  })
  @IsOptional()
  @IsIn(Object.values(PaymentMethod), { message: 'Invalid payment method' })
  paymentMethod?: string;

  @AutoMap()
  @ApiProperty({ required: false, example: '0987654321' })
  @IsOptional()
  phonenumber?: string;

  @AutoMap()
  @ApiProperty({
    required: false,
    example: AccountRevenueCustomerType.ALL,
    enum: Object.values(AccountRevenueCustomerType),
  })
  @IsOptional()
  @IsEnum(AccountRevenueCustomerType, { message: 'Invalid customer type' })
  customerType: string = AccountRevenueCustomerType.ALL;

  @AutoMap()
  @ApiProperty({
    description: 'Time grouping unit',
    enum: UserStatisticsGroupBy,
    default: UserStatisticsGroupBy.DAY,
    required: false,
  })
  @IsOptional()
  @IsEnum(UserStatisticsGroupBy)
  @Type(() => String)
  groupBy?: UserStatisticsGroupBy = UserStatisticsGroupBy.DAY;
}

export class AccountRevenueStatisticQueryResponseDto {
  @AutoMap()
  time: string;

  @AutoMap()
  count: string;

  @AutoMap()
  countPoint: string;

  @AutoMap()
  countBank: string;

  @AutoMap()
  countCash: string;

  @AutoMap()
  countCreditCard: string;

  @AutoMap()
  totalAmount: string;

  @AutoMap()
  totalAmountPoint: string;

  @AutoMap()
  totalAmountBank: string;

  @AutoMap()
  totalAmountCash: string;

  @AutoMap()
  totalAmountCreditCard: string;
}

export class AccountRevenueQueryResponseDto {
  @AutoMap()
  customerSlug: string;

  @AutoMap()
  customerName: string;

  @AutoMap()
  customerRegisteredAt: Date;

  @AutoMap()
  totalAmount: string;

  @AutoMap()
  totalAmountPoint: string;

  @AutoMap()
  totalAmountBank: string;

  @AutoMap()
  totalAmountCash: string;

  @AutoMap()
  totalAmountCreditCard: string;
}

export class AccountRevenueCustomerResponseDto {
  @AutoMap()
  @ApiProperty()
  customerSlug: string;

  @AutoMap()
  @ApiProperty()
  customerName: string;

  @AutoMap()
  @ApiProperty()
  customerRegisteredAt: Date;

  @AutoMap()
  @ApiProperty()
  totalAmount: number;

  @AutoMap()
  @ApiProperty()
  totalAmountPoint: number;

  @AutoMap()
  @ApiProperty()
  totalAmountBank: number;

  @AutoMap()
  @ApiProperty()
  totalAmountCash: number;

  @AutoMap()
  @ApiProperty()
  totalAmountCreditCard: number;
}

export class AccountRevenueSummaryResponseDto {
  @AutoMap()
  @ApiProperty()
  totalAmount: number;

  @AutoMap()
  @ApiProperty()
  totalAmountPoint: number;

  @AutoMap()
  @ApiProperty()
  totalAmountBank: number;

  @AutoMap()
  @ApiProperty()
  totalAmountCash: number;

  @AutoMap()
  @ApiProperty()
  totalAmountCreditCard: number;

  // Share (%) of each payment method over total revenue
  @AutoMap()
  @ApiProperty()
  percentPoint: number;

  @AutoMap()
  @ApiProperty()
  percentBank: number;

  @AutoMap()
  @ApiProperty()
  percentCash: number;

  @AutoMap()
  @ApiProperty()
  percentCreditCard: number;
}

export class AccountRevenueStatisticItemDto {
  @AutoMap()
  @ApiProperty({ example: '2026-07-11T00:00:00' })
  time: string;

  @AutoMap()
  @ApiProperty({ example: 42 })
  count: number;

  @AutoMap()
  @ApiProperty({ example: 12 })
  countPoint: number;

  @AutoMap()
  @ApiProperty({ example: 15 })
  countBank: number;

  @AutoMap()
  @ApiProperty({ example: 10 })
  countCash: number;

  @AutoMap()
  @ApiProperty({ example: 5 })
  countCreditCard: number;

  @AutoMap()
  @ApiProperty({ example: 1500000 })
  totalAmount: number;

  @AutoMap()
  @ApiProperty({ example: 500000 })
  totalAmountPoint: number;

  @AutoMap()
  @ApiProperty({ example: 500000 })
  totalAmountBank: number;

  @AutoMap()
  @ApiProperty({ example: 300000 })
  totalAmountCash: number;

  @AutoMap()
  @ApiProperty({ example: 200000 })
  totalAmountCreditCard: number;
}

export class AggregateAccountRevenueResponseDto {
  @AutoMap()
  @ApiProperty({ type: AccountRevenueSummaryResponseDto })
  summary: AccountRevenueSummaryResponseDto;

  @AutoMap()
  @ApiProperty({ type: AccountRevenueCustomerResponseDto, isArray: true })
  customers: AccountRevenueCustomerResponseDto[];

  @AutoMap()
  @ApiProperty({ type: AccountRevenueStatisticItemDto, isArray: true })
  data: AccountRevenueStatisticItemDto[];

  @AutoMap()
  @ApiProperty({ example: 100 })
  total: number;
}
