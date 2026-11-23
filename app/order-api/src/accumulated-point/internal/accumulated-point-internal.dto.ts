import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WALLET_TRANSACTION_ID_PATTERN } from 'src/gift-card-modules/balance/internal/balance-internal.dto';
import {
  AccumulatedPointTransactionType,
  RESERVATION_KEY_MAX,
} from '../accumulated-point.constants';

// Step 8.5: one "view on behalf" history page is at most this many rows -
// the screens ask 10 to 50. `hasPaging: false` still reads every row, as
// the route of trend / terminal it replaces did.
export const INTERNAL_POINTS_HISTORY_PAGE_MAX = 200;

// Request bodies of /internal/accumulated-points/* (step 6.7). Same rules as
// /internal/balance/*: a user is a shared-user id, a transaction is the key
// the calling service sends ('<service>:<reference>[:<op>[:<seq>]]', the
// pattern of balance-internal.dto.ts), and the object that produced it is a
// soft reference stored with the history row, never looked up.
//
// Order of decorators: HttpExceptionFilter keeps only the FIRST message and
// class-validator reports in reverse declaration order, so the type check is
// declared last.

export class LookupAccumulatedPointRequestDto {
  @IsNotEmpty({ message: 'userId is required' })
  @IsString({ message: 'userId must be a string' })
  userId: string;
}

// Step 8.5: POST /internal/accumulated-points/history - the "view on behalf"
// history of one person (QD17). A JSON body, so the fields are declared
// again instead of extending GetPointHistoryQueryDto: its `hasPaging` turns
// the STRING 'true' into true, a JSON `true` would become false. Defaults:
// hasPaging true, page 1, size 10 (those of the query string).
export class PointsHistoryAccumulatedPointRequestDto {
  @IsOptional()
  @IsString({ message: 'toDate must be a string' })
  toDate?: string;

  @IsOptional()
  @IsString({ message: 'fromDate must be a string' })
  fromDate?: string;

  @IsOptional()
  @IsBoolean({ message: 'hasPaging must be a boolean' })
  hasPaging?: boolean;

  @IsOptional()
  @Max(INTERNAL_POINTS_HISTORY_PAGE_MAX, {
    message: `size must be at most ${INTERNAL_POINTS_HISTORY_PAGE_MAX}`,
  })
  @Min(1, { message: 'size must be at least 1' })
  @IsInt({ message: 'size must be an integer' })
  size?: number;

  @IsOptional()
  @Min(1, { message: 'page must be at least 1' })
  @IsInt({ message: 'page must be an integer' })
  page?: number;

  @IsIn(Object.values(AccumulatedPointTransactionType), {
    each: true,
    message: 'each type must be one of add, use, reserve, refund',
  })
  @ArrayNotEmpty({ message: 'types must not be empty' })
  @IsArray({ message: 'types must be an array' })
  types: string[];

  @IsNotEmpty({ message: 'userId is required' })
  @IsString({ message: 'userId must be a string' })
  userId: string;
}

export class BatchLookupAccumulatedPointRequestDto {
  @IsString({ each: true, message: 'each userId must be a string' })
  @ArrayNotEmpty({ message: 'userIds must not be empty' })
  @IsArray({ message: 'userIds must be an array' })
  userIds: string[];
}

// Common part of add and reserve.
class AccumulatedPointMoveRequestDto {
  @IsNotEmpty({ message: 'userId is required' })
  @IsString({ message: 'userId must be a string' })
  userId: string;

  @Min(1, { message: 'points must be greater than 0' })
  @IsInt({ message: 'points must be an integer' })
  @Type(() => Number)
  points: number;

  @Matches(WALLET_TRANSACTION_ID_PATTERN, {
    message: 'transactionId must look like <service>:<reference>',
  })
  @MaxLength(191, { message: 'transactionId is at most 191 characters' })
  @IsString({ message: 'transactionId must be a string' })
  transactionId: string;

  // Soft reference to the object of the calling service the points are for
  // (e.g. 'ORDER' + its id and slug there). objectSlug is the slug in that
  // service; the history row stores it as '<service>:<objectSlug>' (the
  // convention of step 6.2), the service being the prefix of transactionId.
  @MaxLength(255, { message: 'objectType is at most 255 characters' })
  @IsNotEmpty({ message: 'objectType is required' })
  @IsString({ message: 'objectType must be a string' })
  objectType: string;

  @MaxLength(255, { message: 'objectId is at most 255 characters' })
  @IsNotEmpty({ message: 'objectId is required' })
  @IsString({ message: 'objectId must be a string' })
  objectId: string;

  @MaxLength(200, { message: 'objectSlug is at most 200 characters' })
  @IsNotEmpty({ message: 'objectSlug is required' })
  @IsString({ message: 'objectSlug must be a string' })
  objectSlug: string;
}

// add (QD-T4): points is the number the caller already computed with its own
// rate; shared-user does not apply any rate. pointsPercentage is that rate,
// optional, stored on the history row for the record only (0 when absent).
export class AddAccumulatedPointRequestDto extends AccumulatedPointMoveRequestDto {
  @IsOptional()
  @Max(100, { message: 'pointsPercentage is at most 100' })
  @Min(0, { message: 'pointsPercentage must not be negative' })
  @IsInt({ message: 'pointsPercentage must be an integer' })
  @Type(() => Number)
  pointsPercentage?: number;
}

// reserve: the key is shorter so that K:confirm and K:cancel fit the key
// column. expiresAt (QD11, ISO 8601) is when the reservation is released if
// nobody confirms or cancels it; see RESERVATION_TTL_ENV for the default.
export class ReserveAccumulatedPointRequestDto extends AccumulatedPointMoveRequestDto {
  @MaxLength(RESERVATION_KEY_MAX, {
    message: `transactionId of a reservation is at most ${RESERVATION_KEY_MAX} characters`,
  })
  transactionId: string;

  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'expiresAt must be an ISO 8601 date' },
  )
  expiresAt?: string;
}

// confirm / cancel-reservation: the key of the reservation.
export class ReservationKeyRequestDto {
  @Matches(WALLET_TRANSACTION_ID_PATTERN, {
    message: 'transactionId must look like <service>:<reference>',
  })
  @MaxLength(RESERVATION_KEY_MAX, {
    message: `transactionId of a reservation is at most ${RESERVATION_KEY_MAX} characters`,
  })
  @IsString({ message: 'transactionId must be a string' })
  transactionId: string;
}

// Response of lookup / batch-lookup: points is the total of the user that
// can be spent now (reservations are already taken out of it, see
// reserve), 0 when the user has no points row yet.
export interface AccumulatedPointLookupResponse {
  userId: string;
  points: number;
}

// Response of add / reserve / confirm / cancel-reservation: the history row
// written (transactionId is its key: the key sent for add and reserve,
// K:confirm or K:cancel for the other two), totalPoints right after it, and
// the soft reference as the caller knows it (objectSlug without the service
// prefix). type is add, reserve, use (confirm) or refund (cancel); status is
// pending for an open reservation, confirmed otherwise. A replay of the same
// key returns the same row with replayed = true and changes nothing.
export interface AccumulatedPointMoveResponse {
  transactionId: string;
  userId: string;
  type: string;
  status: string;
  points: number;
  totalPoints: number;
  objectType: string | null;
  objectId: string | null;
  objectSlug: string | null;
  expiresAt: Date | null;
  replayed: boolean;
  createdAt: Date;
}
