import {
  BadRequestException,
  Body,
  Controller,
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
import {
  PointTransactionScope,
  PointTransactionService,
} from '../point-transaction.service';
import {
  ExportPointTransactionsRequestDto,
  QueryPointTransactionsRequestDto,
} from './point-transaction-internal.dto';

// Step 6.10 (QD17): the view on behalf of someone else (staff reading the
// coin history of a customer, analysis and exports of the whole system).
// Whether one user may read another one's wallet is a question about the role
// in the shop, which the calling service owns, so these routes are internal
// only: the caller checks the role, then asks here. Same fence as the other
// internal controllers (InternalApiGuard on the class, @Public() on every
// route, POST only). They replace the client routes /point-transaction/
// analysis, /export, /export/system and /:slug/export.
//
// QD-T5: with userId, every transaction of that user, each row carrying the
// service that wrote it; without userId, "the whole system" is the whole
// system of the calling service: the rows written under its keys. The soft
// reference of a row (objectSlug, objectType) only resolves in the service
// that wrote it, and trend has object types terminal does not know.
// x-internal-service is therefore required here.
@UseGuards(InternalApiGuard)
@Controller('internal/point-transactions')
export class PointTransactionInternalController {
  constructor(
    private readonly pointTransactionService: PointTransactionService,
  ) {}

  // Page of transactions with the statistics of the old client list; rows
  // have the old fields plus service.
  @Public()
  @Post('query')
  async query(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: QueryPointTransactionsRequestDto,
    @Req() request: InternalRequest,
  ) {
    const scope = this.scopeOf(body.userId, request.internalService);
    return this.pointTransactionService.findPageForService(body, scope);
  }

  // totalEarned / totalSpent / netDifference and the statistics per bucket.
  @Public()
  @Post('analysis')
  async analysis(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: QueryPointTransactionsRequestDto,
    @Req() request: InternalRequest,
  ) {
    const scope = this.scopeOf(body.userId, request.internalService);
    return this.pointTransactionService.analyze(body, scope);
  }

  // The rows of an export as data ({ items, total }), oldest first; the
  // caller builds the spreadsheet or the receipt. Refused above
  // POINT_TRANSACTION_EXPORT_MAX_ROWS rows instead of truncated.
  @Public()
  @Post('export')
  async export(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: ExportPointTransactionsRequestDto,
    @Req() request: InternalRequest,
  ) {
    const scope = this.scopeOf(body.userId, request.internalService);
    return this.pointTransactionService.exportRows(body, scope);
  }

  private scopeOf(
    userId: string | undefined,
    internalService: string | null | undefined,
  ): PointTransactionScope {
    if (!internalService) {
      throw new BadRequestException(
        'x-internal-service is required to read point transactions',
      );
    }
    return userId ? { userId } : { service: internalService };
  }
}
