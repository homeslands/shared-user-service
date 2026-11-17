import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  Inject,
  Logger,
} from '@nestjs/common';
import { BalanceService } from './balance.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppResponseDto } from 'src/app/app.dto';
import { CurrentUser } from 'src/user/user.decorator';
import { CurrentUserDto } from 'src/user/user.dto';
import {
  BalanceResponseDto,
  MaxBalanceResponseDto,
} from './dto/balance-response.dto';
import { ApiResponseWithType } from 'src/app/app.decorator';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

@Controller('balance')
@ApiTags('Balance Resource')
@ApiBearerAuth()
export class BalanceController {
  constructor(
    private readonly balanceService: BalanceService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
  ) {}

  // Step 6.9 (QD17): the self view. The balance read is the one of the user
  // of the token; the query string names no one (it used to take a user slug,
  // which let anyone logged in read anyone's balance). No role is required:
  // the role of shared-user is not the one of the calling service (QD15), and
  // a customer logged in from terminal-ui reads its own balance here too.
  @Get()
  @ApiOperation({ summary: 'Get the balance of the current user' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'The balance was retrieved successfully',
    type: BalanceResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  async findMine(
    @CurrentUser(new ValidationPipe({ validateCustomDecorators: true }))
    user: CurrentUserDto,
  ) {
    const result = await this.balanceService.findOneByUserId(user.userId);
    return {
      message: 'The balance was retrieved successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<BalanceResponseDto>;
  }

  @Get('/analysis')
  @ApiOperation({ summary: 'Analyze balance in the system' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'Analyze balance in the system',
    type: MaxBalanceResponseDto,
  })
  async maxBalance(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    payload: any,
  ) {
    const context = `${BalanceController.name}.${this.maxBalance.name}`;
    this.logger.log(
      `REST request to analyze balance: ${JSON.stringify(payload)}`,
      context,
    );

    const result = await this.balanceService.maxBalance(payload);
    return {
      message: '',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<MaxBalanceResponseDto>;
  }
}
