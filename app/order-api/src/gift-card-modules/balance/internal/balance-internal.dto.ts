import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// Request bodies of /internal/balance/* (step 6.5). The wallet knows a user by
// shared-user id and a transaction by the key the calling service sends; it
// knows nothing of the caller's own objects beyond the soft reference it
// stores with the ledger row (objectType / objectId / objectSlug).
//
// Order of decorators: HttpExceptionFilter keeps only the FIRST message and
// class-validator reports in reverse declaration order, so the type check is
// declared last.

// '<service>:<reference>[:<op>[:<seq>]]', at most 191 characters (the
// idempotency column of step 6.3).
export const WALLET_TRANSACTION_ID_PATTERN = /^[a-z][a-z0-9-]*:\S+$/;

export class LookupBalanceRequestDto {
  @IsNotEmpty({ message: 'userId is required' })
  @IsString({ message: 'userId must be a string' })
  userId: string;
}

export class BatchLookupBalanceRequestDto {
  @IsString({ each: true, message: 'each userId must be a string' })
  @ArrayNotEmpty({ message: 'userIds must not be empty' })
  @IsArray({ message: 'userIds must be an array' })
  userIds: string[];
}

export class CreditBalanceRequestDto {
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

  // Soft reference to the object of the calling service that produced the
  // transaction (e.g. 'gift-card' + its id and slug there). Stored as is,
  // never looked up: shared-user does not own those objects.
  @MaxLength(255, { message: 'objectType is at most 255 characters' })
  @IsNotEmpty({ message: 'objectType is required' })
  @IsString({ message: 'objectType must be a string' })
  objectType: string;

  @MaxLength(255, { message: 'objectId is at most 255 characters' })
  @IsNotEmpty({ message: 'objectId is required' })
  @IsString({ message: 'objectId must be a string' })
  objectId: string;

  @MaxLength(255, { message: 'objectSlug is at most 255 characters' })
  @IsNotEmpty({ message: 'objectSlug is required' })
  @IsString({ message: 'objectSlug must be a string' })
  objectSlug: string;

  @IsOptional()
  @MaxLength(255, { message: 'desc is at most 255 characters' })
  @IsString({ message: 'desc must be a string' })
  desc?: string;
}

// Response of lookup / batch-lookup: points is the balance (xu) of the user,
// 0 when the user has no balance row yet.
export interface BalanceLookupResponse {
  userId: string;
  points: number;
}

// Response of credit. balance is the balance right after this transaction
// (the caller no longer reads it back). A replay of the same transactionId
// returns the same transaction and balance with replayed = true and changes
// nothing.
export interface BalanceCreditResponse {
  transactionId: string;
  userId: string;
  points: number;
  balance: number;
  replayed: boolean;
  createdAt: Date;
}
