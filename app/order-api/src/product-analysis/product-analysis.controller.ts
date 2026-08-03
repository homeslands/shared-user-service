import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import { ProductAnalysisService } from './product-analysis.service';
import { Public } from 'src/auth/decorator/public.decorator';
import { ApiResponseWithType } from 'src/app/app.decorator';
import {
  GetProductAnalysisQueryDto,
  ProductAnalysisResponseDto,
  RefreshSpecificRangeProductAnalysisQueryDto,
} from './product-analysis.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppPaginatedResponseDto, AppResponseDto } from 'src/app/app.dto';
import { Response } from 'express';

@Controller('product-analysis')
export class ProductAnalysisController {
  constructor(
    private readonly productAnalysisService: ProductAnalysisService,
  ) {}

  @Get('top-sell')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'The top-sellers product were retrieved successfully.',
    type: ProductAnalysisResponseDto,
    isArray: true,
  })
  @ApiOperation({ summary: 'Get top-sell products' })
  async getTopSellProducts(
    @Query(new ValidationPipe({ transform: true }))
    query: GetProductAnalysisQueryDto,
  ) {
    const result = await this.productAnalysisService.getTopSellProducts(query);
    return {
      message: 'The top-sellers product were retrieved successfully.',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<AppPaginatedResponseDto<ProductAnalysisResponseDto>>;
  }

  @Get('top-sell/branch/:branch')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'The top-sellers product were retrieved successfully.',
    type: ProductAnalysisResponseDto,
    isArray: true,
  })
  @ApiOperation({ summary: 'Get top-sell products by branch' })
  async getTopSellProductsByBranch(
    @Param('branch') branchSlug: string,
    @Query(new ValidationPipe({ transform: true }))
    query: GetProductAnalysisQueryDto,
  ) {
    const result = await this.productAnalysisService.getTopSellProductsByBranch(
      branchSlug,
      query,
    );
    return {
      message: 'The top-sellers product were retrieved successfully.',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<AppPaginatedResponseDto<ProductAnalysisResponseDto>>;
  }

  @Get('top-sell/branch/:branch/export')
  @Public()
  @ApiOperation({ summary: 'Export top-sell products by branch to Excel' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The product revenue has been exported successfully',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async exportProductRevenueToExcel(
    @Param('branch') branchSlug: string,
    @Query(new ValidationPipe({ transform: true }))
    query: GetProductAnalysisQueryDto,
    @Res() res: Response,
  ) {
    const fileResponse =
      await this.productAnalysisService.exportProductRevenueExcel(
        branchSlug,
        query,
      );

    res.set({
      'Content-Type': fileResponse.mimetype,
      'Content-Disposition': `attachment; filename="${fileResponse.name}.${fileResponse.extension}"`,
      'Content-Length': fileResponse.size,
    });

    res.send(fileResponse.data);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'Refresh product analysis successfully.',
    type: ProductAnalysisResponseDto,
    isArray: true,
  })
  @ApiOperation({ summary: 'Refresh product analysis' })
  async refreshProductAnalysis(
    @Query(new ValidationPipe({ transform: true }))
    query: RefreshSpecificRangeProductAnalysisQueryDto,
  ) {
    await this.productAnalysisService.refreshProductAnalysisInSpecificTimeRange(
      query,
    );
    return {
      message: 'Refresh product analysis successfully.',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result: `Refreshed product analysis successfully.`,
    } as AppResponseDto<string>;
  }
}
