import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Public } from 'src/auth/decorator/public.decorator';
import {
  InternalApiGuard,
  InternalRequest,
} from 'src/common/guards/internal-api.guard';
import { INTERNAL_BATCH_LOOKUP_MAX } from 'src/common/constants/internal-api.constant';
import { BalanceService } from '../balance.service';
import {
  BalanceCreditResponse,
  BalanceLookupResponse,
  BatchLookupBalanceRequestDto,
  CreditBalanceRequestDto,
  LookupBalanceRequestDto,
} from './balance-internal.dto';

// Wallet (xu) routes for the calling services (trend, terminal), step 6.5.
// Same fence as user-internal.controller.ts: InternalApiGuard on the class,
// @Public() on every route (out of the global JWT guard), POST only (the HMAC
// signature covers the method and the clients only have post()).
//
// The wallet is service agnostic (architect-http.md 1.8): a user is a
// shared-user id, a transaction is the caller's key
// '<service>:<reference>[:<op>[:<seq>]]'. This layer resolves the User once and
// hands the entity to BalanceService.
//
// Step 6.6 adds debit / release / lookup-transaction / analysis here. There
// is no reserve / confirm on xu (QD9): the only xu spending path is one step.
@UseGuards(InternalApiGuard)
@Controller('internal/balance')
export class BalanceInternalController {
  constructor(private readonly balanceService: BalanceService) {}

  @Public()
  @Post('lookup')
  async lookup(
    @Body(new ValidationPipe({ transform: true }))
    body: LookupBalanceRequestDto,
  ): Promise<BalanceLookupResponse> {
    const [row] = await this.balanceService.lookupPointsByUserIds([
      body.userId,
    ]);
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  // Batch of /lookup (a customer list shows the balance on every row; one
  // call per row is N+1 over the network). Unknown ids are left out, as in
  // /internal/users/batch-lookup. An empty batch or one over
  // INTERNAL_BATCH_LOOKUP_MAX is a 400, never cut silently: the caller splits.
  @Public()
  @Post('batch-lookup')
  async batchLookup(
    @Body(new ValidationPipe({ transform: true }))
    body: BatchLookupBalanceRequestDto,
  ): Promise<BalanceLookupResponse[]> {
    if (body.userIds.length > INTERNAL_BATCH_LOOKUP_MAX) {
      throw new BadRequestException(
        `batch-lookup accepts at most ${INTERNAL_BATCH_LOOKUP_MAX} userIds per call (got ${body.userIds.length}) - split the batch on the caller side`,
      );
    }
    return this.balanceService.lookupPointsByUserIds(body.userIds);
  }

  // Add xu. Idempotent on transactionId: calling again with the same key
  // (retry after a timeout, two replicas at once) changes the balance once and
  // answers with the same transaction. Returns the balance after the
  // transaction.
  //
  // The key must carry the prefix of the calling service: keys of two
  // services never collide, and a caller cannot write under another
  // service's prefix by mistake. x-internal-service is not covered by the
  // signature, so this is a consistency check, not an authorization.
  @Public()
  @Post('credit')
  async credit(
    @Body(new ValidationPipe({ transform: true }))
    body: CreditBalanceRequestDto,
    @Req() request: InternalRequest,
  ): Promise<BalanceCreditResponse> {
    const service = body.transactionId.split(':')[0];
    if (request.internalService && service !== request.internalService) {
      throw new BadRequestException(
        `transactionId prefix '${service}' does not match the calling service '${request.internalService}'`,
      );
    }
    const user = await this.balanceService.findUserById(body.userId);
    if (!user) throw new NotFoundException('User not found');
    return this.balanceService.creditByKey(user, {
      points: body.points,
      transactionId: body.transactionId,
      objectType: body.objectType,
      objectId: body.objectId,
      objectSlug: body.objectSlug,
      desc: body.desc,
    });
  }
}
