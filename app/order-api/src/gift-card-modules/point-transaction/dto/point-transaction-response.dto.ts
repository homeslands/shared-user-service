import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from 'src/app/base.dto';
import { UserResponseDto } from 'src/user/user.dto';

export class PointTransactionResponseDto extends BaseResponseDto {
  @AutoMap()
  @ApiProperty()
  type: string;

  @AutoMap()
  @ApiProperty()
  desc: string;

  @ApiProperty()
  @AutoMap()
  objectType: string;

  @ApiProperty()
  @AutoMap()
  objectSlug: string;

  @ApiProperty()
  @AutoMap()
  points: number;

  @ApiProperty()
  @AutoMap(() => UserResponseDto)
  user: UserResponseDto;

  @ApiProperty()
  @AutoMap()
  userSlug: string;
}

export class PointTransactionStatisticItemDto {
  @ApiProperty({ example: '2024-01-01T00:00:00' })
  @AutoMap()
  time: string;

  @ApiProperty({ description: 'Number of transactions in this time bucket' })
  @AutoMap()
  count: number;

  @AutoMap()
  @ApiProperty()
  type: string;
}

export class AnalysisPointTransactionStatisticItemDto {
  @ApiProperty({ example: '2024-01-01T00:00:00' })
  @AutoMap()
  time: string;

  @ApiProperty({ description: 'Number of transactions in this time bucket' })
  @AutoMap()
  count: number;

  @ApiProperty({
    description: 'Total points earned (type in) in this time bucket',
  })
  @AutoMap()
  earn: number;

  @ApiProperty({
    description: 'Total points spent (type out) in this time bucket',
  })
  @AutoMap()
  spend: number;
}

export class AnalysisPointTransactionResponseDto {
  @ApiProperty()
  @AutoMap()
  totalEarned: number;

  @ApiProperty()
  @AutoMap()
  totalSpent: number;

  @ApiProperty()
  @AutoMap()
  netDifference: number;

  @ApiProperty({ type: [AnalysisPointTransactionStatisticItemDto] })
  @AutoMap(() => [AnalysisPointTransactionStatisticItemDto])
  statistics: AnalysisPointTransactionStatisticItemDto[];
}
