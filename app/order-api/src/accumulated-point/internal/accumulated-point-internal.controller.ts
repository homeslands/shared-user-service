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
import { AccumulatedPointService } from '../accumulated-point.service';
import { serviceOfRef } from '../accumulated-point.constants';
import {
  AccumulatedPointLookupResponse,
  AccumulatedPointMoveResponse,
  AddAccumulatedPointRequestDto,
  BatchLookupAccumulatedPointRequestDto,
  LookupAccumulatedPointRequestDto,
  ReservationKeyRequestDto,
  ReserveAccumulatedPointRequestDto,
} from './accumulated-point-internal.dto';

// Accumulated point routes for the calling services (trend, terminal), step
// 6.7. Same fence as balance-internal.controller.ts: InternalApiGuard on the
// class, @Public() on every route, POST only.
//
// Here the two steps are real: between reserve and confirm there is the whole
// life of the caller's object (an order), and the reservation lives in the
// history table of the wallet, not on that object.
//
// The wallet makes none of the caller's business checks (6A-3): not the
// status of the object, not the role of the person, not whether the object
// exists. It guarantees three things only: points never go below zero, a key
// is written once, and a person holds at most one active reservation per
// calling service (QD-T3; the service is the prefix of the key, which must be
// the one of x-internal-service).
@UseGuards(InternalApiGuard)
@Controller('internal/accumulated-points')
export class AccumulatedPointInternalController {
  constructor(
    private readonly accumulatedPointService: AccumulatedPointService,
  ) {}

  @Public()
  @Post('lookup')
  async lookup(
    @Body(new ValidationPipe({ transform: true }))
    body: LookupAccumulatedPointRequestDto,
  ): Promise<AccumulatedPointLookupResponse> {
    const [row] = await this.accumulatedPointService.lookupPointsByUserIds([
      body.userId,
    ]);
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  // Batch of /lookup, same rules as /internal/balance/batch-lookup: unknown
  // ids are left out, an empty batch or one over INTERNAL_BATCH_LOOKUP_MAX is
  // a 400.
  @Public()
  @Post('batch-lookup')
  async batchLookup(
    @Body(new ValidationPipe({ transform: true }))
    body: BatchLookupAccumulatedPointRequestDto,
  ): Promise<AccumulatedPointLookupResponse[]> {
    if (body.userIds.length > INTERNAL_BATCH_LOOKUP_MAX) {
      throw new BadRequestException(
        `batch-lookup accepts at most ${INTERNAL_BATCH_LOOKUP_MAX} userIds per call (got ${body.userIds.length}) - split the batch on the caller side`,
      );
    }
    return this.accumulatedPointService.lookupPointsByUserIds(body.userIds);
  }

  // Add points (QD-T4): exactly the number sent, computed by the caller with
  // its own rate. Idempotent on transactionId ('<service>:<reference>:add').
  @Public()
  @Post('add')
  async add(
    @Body(new ValidationPipe({ transform: true }))
    body: AddAccumulatedPointRequestDto,
    @Req() request: InternalRequest,
  ): Promise<AccumulatedPointMoveResponse> {
    this.assertKeyOfCaller(body.transactionId, request);
    const user = await this.accumulatedPointService.findInternalUser(
      body.userId,
    );
    if (!user) throw new NotFoundException('User not found');
    return this.accumulatedPointService.addByKey(user.id, {
      points: body.points,
      transactionId: body.transactionId,
      objectType: body.objectType,
      objectId: body.objectId,
      objectSlug: body.objectSlug,
      pointsPercentage: body.pointsPercentage,
    });
  }

  // Hold points for an object of the calling service until confirm, cancel
  // or expiresAt. Idempotent on transactionId ('<service>:<reference>:reserve',
  // a new key for every new reservation). A second reservation of the same
  // object replaces the open one; one for another object while the first is
  // open is refused (POINTS_ALREADY_RESERVED_FOR_OTHER_ORDER).
  @Public()
  @Post('reserve')
  async reserve(
    @Body(new ValidationPipe({ transform: true }))
    body: ReserveAccumulatedPointRequestDto,
    @Req() request: InternalRequest,
  ): Promise<AccumulatedPointMoveResponse> {
    this.assertKeyOfCaller(body.transactionId, request);
    const expiresAt = this.accumulatedPointService.resolveReservationExpiry(
      body.expiresAt,
    );
    const user = await this.accumulatedPointService.findInternalUser(
      body.userId,
    );
    if (!user) throw new NotFoundException('User not found');
    return this.accumulatedPointService.reserveByKey(
      user.id,
      {
        points: body.points,
        transactionId: body.transactionId,
        objectType: body.objectType,
        objectId: body.objectId,
        objectSlug: body.objectSlug,
      },
      expiresAt,
    );
  }

  // Spend the points of a reservation, called with the key K of the
  // reservation; writes K:confirm. Confirming twice confirms once. 404 when K
  // was never written, 409 when K is not a reservation or is no longer open
  // (cancelled, released on expiry).
  @Public()
  @Post('confirm')
  async confirm(
    @Body(new ValidationPipe({ transform: true }))
    body: ReservationKeyRequestDto,
    @Req() request: InternalRequest,
  ): Promise<AccumulatedPointMoveResponse> {
    this.assertKeyOfCaller(body.transactionId, request);
    return this.accumulatedPointService.confirmReservationByKey(
      body.transactionId,
    );
  }

  // Give the points of a reservation back, called with the key K of the
  // reservation; writes K:cancel. Cancelling twice gives back once. 404 when
  // K was never written, 409 when K is not a reservation or was confirmed.
  @Public()
  @Post('cancel-reservation')
  async cancelReservation(
    @Body(new ValidationPipe({ transform: true }))
    body: ReservationKeyRequestDto,
    @Req() request: InternalRequest,
  ): Promise<AccumulatedPointMoveResponse> {
    this.assertKeyOfCaller(body.transactionId, request);
    return this.accumulatedPointService.cancelReservationByKey(
      body.transactionId,
    );
  }

  // The key carries the prefix of the calling service: the reservation
  // invariant is per (person, service) and the service is read from that
  // prefix, so a caller must not write under another one. Same rule as
  // /internal/balance/*; x-internal-service is not covered by the signature,
  // so this is a consistency check, not an authorization.
  private assertKeyOfCaller(
    transactionId: string,
    request: InternalRequest,
  ): void {
    const service = serviceOfRef(transactionId);
    if (request.internalService && service !== request.internalService) {
      throw new BadRequestException(
        `transactionId prefix '${service}' does not match the calling service '${request.internalService}'`,
      );
    }
  }
}
