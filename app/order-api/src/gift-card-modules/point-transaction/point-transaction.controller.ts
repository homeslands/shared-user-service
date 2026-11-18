import { Controller, Get, Param, HttpCode, HttpStatus, Query, ValidationPipe } from '@nestjs/common';
import { PointTransactionService } from './point-transaction.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiResponseWithType } from 'src/app/app.decorator';
import {
  PointTransactionResponseDto,
  PointTransactionStatisticItemDto,
} from './dto/point-transaction-response.dto';
import { AppPaginatedResponseDto, AppResponseDto } from 'src/app/app.dto';
import { FindAllPointTransactionDto } from './dto/find-all-point-transaction.dto';
import { CurrentUser } from 'src/user/user.decorator';
import { CurrentUserDto } from 'src/user/user.dto';

// Same as @RestController({ path, tags }), written out like the other wallet
// controllers (balance, accumulated-point).
//
// Step 6.10 (QD17): the analysis and the exports (/analysis, /export,
// /export/system, /:slug/export) read the transactions of other users or of
// the whole system, so they are no client routes here any more: they moved to
// POST /internal/point-transactions/*, behind the role check of the calling
// service. POST / and GET /:slug are left to the route x role review of step
// 6.18 (BE-18 in progress/loi-co-tu-truoc.md).
@Controller('point-transaction')
@ApiTags('Point Transaction Resources')
@ApiBearerAuth()
export class PointTransactionController {
  constructor(
    private readonly pointTransactionService: PointTransactionService,
  ) {}

  // Step 6.9 (QD17): the self view. Only the transactions of the user of the
  // token; the query string filters them (type, dates, k) but names no user.
  // No role is required (QD15), a customer of terminal-ui reads its own too.
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve the point transactions of the current user',
  })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    type: PointTransactionResponseDto,
    isArray: true,
  })
  async findAll(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    req: FindAllPointTransactionDto,
    @CurrentUser(new ValidationPipe({ validateCustomDecorators: true }))
    user: CurrentUserDto,
  ) {
    const result = await this.pointTransactionService.findAll(req, user.userId);
    return {
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<
      AppPaginatedResponseDto<PointTransactionResponseDto> & {
        statistics: PointTransactionStatisticItemDto[];
      }
    >;
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retrieve the point transaction' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    type: PointTransactionResponseDto,
  })
  async findOne(@Param('slug') slug: string) {
    const result = await this.pointTransactionService.findOne(slug);
    return {
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<PointTransactionResponseDto>;
  }
}
