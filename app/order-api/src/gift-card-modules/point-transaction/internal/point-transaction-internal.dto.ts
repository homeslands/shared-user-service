import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import moment from 'moment';
import { FindAllPointTransactionDto } from '../dto/find-all-point-transaction.dto';

// Bodies of /internal/point-transactions/* (step 6.10, QD17): the view on
// behalf of someone, which the calling service only sends after checking the
// role of its own user. userId is a shared-user id; without it the request
// covers the transactions of the calling service only (QD-T5, the service
// being x-internal-service).

export const POINT_TRANSACTION_QUERY_MAX_PAGE_SIZE = 1000;

// /query and /analysis: the filters of the old client list
// (type, startDate, endDate, k, groupBy, page, size, sort) plus userId, which
// replaces the user slug of the old query string.
export class QueryPointTransactionsRequestDto extends FindAllPointTransactionDto {
  @IsOptional()
  @IsNotEmpty({ message: 'userId must not be empty' })
  @IsString({ message: 'userId must be a string' })
  userId?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(POINT_TRANSACTION_QUERY_MAX_PAGE_SIZE)
  size: number = 10;
}

// /export: the filters of the old client exports. slug picks one transaction
// (the old /:slug/export receipt).
export class ExportPointTransactionsRequestDto {
  @IsOptional()
  @IsNotEmpty({ message: 'userId must not be empty' })
  @IsString({ message: 'userId must be a string' })
  userId?: string;

  @IsOptional()
  @IsString({ message: 'slug must be a string' })
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString({ message: 'type must be a string' })
  type?: string;

  @IsOptional()
  @Transform(({ value }) => moment(value, 'YYYY-MM-DD').startOf('day').toDate())
  fromDate?: Date;

  @IsOptional()
  @Transform(({ value }) => moment(value, 'YYYY-MM-DD').endOf('day').toDate())
  toDate?: Date;
}
