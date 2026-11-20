import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { AccumulatedPointService } from './accumulated-point.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppPaginatedResponseDto, AppResponseDto } from 'src/app/app.dto';
import {
  AccumulatedPointResponseDto,
  GetPointHistoryQueryDto,
  PointTransactionHistoryResponseDto,
} from './accumulated-point.dto';
import { ApiResponseWithType } from 'src/app/app.decorator';

import { CurrentUser } from 'src/user/user.decorator';
import { CurrentUserDto } from 'src/user/user.dto';

// Step 6.9 (QD17): the client-facing side of accumulated points is the self
// view only. Both routes read the points of the user of the token; the path
// names no user any more (it was user/:slug/points and user/:slug/history,
// which let anyone logged in read anyone's points). No role is required: the
// role of shared-user is not the one of the calling service (QD15).
//
// Holding, confirming and cancelling points for an order is not a client
// route of the wallet: the order lives in the calling service, which checks
// it and calls /internal/accumulated-points/* (step 6.7). The routes
// order/:slug/apply-points and order/:slug/cancel-reservation stay on trend.
@Controller('accumulated-point')
@ApiTags('Accumulated Points')
@ApiBearerAuth()
export class AccumulatedPointController {
  constructor(
    private readonly accumulatedPointService: AccumulatedPointService,
  ) {}

  @Get('points')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get total points of the current user' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'Get total points of user successfully',
    type: AccumulatedPointResponseDto,
  })
  async getTotalPoints(
    @CurrentUser(new ValidationPipe({ validateCustomDecorators: true }))
    user: CurrentUserDto,
  ): Promise<AppResponseDto<AccumulatedPointResponseDto>> {
    const result = await this.accumulatedPointService.getTotalPointsOfUser(
      user.userId,
    );
    return {
      message: 'Get total points of user successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<AccumulatedPointResponseDto>;
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get accumulated points history of the current user',
  })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'Get accumulated points history of user successfully',
    type: PointTransactionHistoryResponseDto,
    isArray: true,
  })
  async getPointsHistory(
    @Query(new ValidationPipe({ transform: true }))
    query: GetPointHistoryQueryDto,
    @CurrentUser(new ValidationPipe({ validateCustomDecorators: true }))
    user: CurrentUserDto,
  ): Promise<
    AppResponseDto<AppPaginatedResponseDto<PointTransactionHistoryResponseDto>>
  > {
    const result = await this.accumulatedPointService.getPointsHistory(
      user.userId,
      query,
    );
    return {
      message: 'Get accumulated points history of user successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<
      AppPaginatedResponseDto<PointTransactionHistoryResponseDto>
    >;
  }
}
