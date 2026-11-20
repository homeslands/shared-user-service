import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { BalanceService } from './balance.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppResponseDto } from 'src/app/app.dto';
import { CurrentUser } from 'src/user/user.decorator';
import { CurrentUserDto } from 'src/user/user.dto';
import { BalanceResponseDto } from './dto/balance-response.dto';
import { ApiResponseWithType } from 'src/app/app.decorator';

// Step 6.10 (QD17): the client side of the coin wallet is the self view only.
// The analysis of every balance (the old GET /balance/analysis) is a view on
// behalf of the shop and moved to POST /internal/balance/analysis, which the
// calling service reaches after checking the role of its user.
@Controller('balance')
@ApiTags('Balance Resource')
@ApiBearerAuth()
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

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
}
