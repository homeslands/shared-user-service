import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import moment from 'moment';
import { BaseQueryDto } from 'src/app/base.dto';
import { PointTransactionGroupBy } from '../entities/point-transaction.enum';

// Step 6.9 (QD17): no user slug any more. GET /point-transaction is the self
// view and filters on the user of the token; the history of someone else is
// read by trend through an internal route after checking the role (6.10).
export class FindAllPointTransactionDto extends BaseQueryDto {
  @ApiProperty({
    required: false,
  })
  @IsOptional()
  type: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => moment(value, 'YYYY-MM-DD').startOf('day').toDate())
  startDate: Date;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => moment(value, 'YYYY-MM-DD').endOf('day').toDate())
  endDate: Date;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  k: string;

  @ApiProperty({
    description: 'Time grouping unit for the transaction count statistics',
    enum: PointTransactionGroupBy,
    default: PointTransactionGroupBy.DAY,
    required: false,
  })
  @IsOptional()
  @IsEnum(PointTransactionGroupBy)
  groupBy?: PointTransactionGroupBy = PointTransactionGroupBy.DAY;
}
