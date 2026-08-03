import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import moment from 'moment';
import { BaseQueryDto } from 'src/app/base.dto';
import { PointTransactionGroupBy } from '../entities/point-transaction.enum';

export class FindAllPointTransactionDto extends BaseQueryDto {
  @IsOptional()
  @ApiProperty({
    required: false,
  })
  @AutoMap()
  userSlug?: string;

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
