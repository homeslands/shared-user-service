import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindManyOptions,
  FindOptionsWhere,
  Repository,
  Between,
  In,
} from 'typeorm';
import { AccumulatedPoint } from './entities/accumulated-point.entity';
import { AccumulatedPointTransactionHistory } from './entities/accumulated-point-transaction-history.entity';
import {
  AccumulatedPointTransactionType,
  AccumulatedPointTransactionStatus,
  ACCUMULATED_POINT_OBJECT_TYPE_ORDER,
  ACTIVE_RESERVATION_INDEX,
  HISTORY_KEY_INDEX,
  POINTS_KEY_INDEX,
  RESERVATION_CANCEL_SUFFIX,
  RESERVATION_CONFIRM_SUFFIX,
  RESERVATION_DEFAULT_TTL_MINUTES,
  RESERVATION_MAX_TTL_MINUTES,
  RESERVATION_TTL_ENV,
  orderSlugOfRef,
  serviceOfRef,
} from './accumulated-point.constants';
import {
  AccumulatedPointLookupResponse,
  AccumulatedPointMoveResponse,
} from './internal/accumulated-point-internal.dto';
import { InjectMapper } from '@automapper/nestjs';
import { Mapper } from '@automapper/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import {
  AccumulatedPointResponseDto,
  IAddPointsDto,
  GetPointHistoryQueryDto,
  PointTransactionHistoryResponseDto,
} from './accumulated-point.dto';
import { AppPaginatedResponseDto } from 'src/app/app.dto';
import { AccumulatedPointException } from './accumulated-point.exception';
import { AccumulatedPointValidation } from './accumulated-point.validation';
import {
  calculateAccumulatedPoints,
  isCustomer,
  isDefaultCustomer,
} from './accumulated-point.utils';
import { User } from 'src/user/user.entity';
import { ConfigService } from '@nestjs/config';
import { legacyTrendOrderRef } from 'src/shared/constants/legacy-order-ref.constant';
import { SystemConfigService } from 'src/system-config/system-config.service';
import { SystemConfigKey } from 'src/system-config/system-config.constant';

const isDuplicateKey = (error: any, index?: string): boolean =>
  (error?.code ?? error?.driverError?.code) === 'ER_DUP_ENTRY' &&
  (!index || String(error?.message).includes(index));

// A write of /internal/accumulated-points/* (step 6.7): the key of the
// calling service and the soft reference of its object.
export interface PointMoveInput {
  points: number;
  transactionId: string;
  objectType: string;
  objectId: string;
  objectSlug: string;
}

// A history row as the internal routes read it, with the user it belongs to
// (user_tbl.accumulated_point_column points at the points row).
interface KeyedHistoryRow {
  id: string;
  accumulatedPointId: string;
  userId: string;
  type: string;
  status: string;
  points: number;
  lastPoints: number;
  objectType: string | null;
  objectId: string | null;
  objectSlug: string | null;
  externalTransactionId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

// What a replay must match: a key reused for another user, another kind of
// write, another amount (or, for a reservation, another object) is a bug of
// the caller and must not pass as a replay.
interface ReplayExpectation {
  userId: string;
  type: AccumulatedPointTransactionType;
  points: number;
  objectType?: string;
  objectId?: string;
}

// The points row of a person, locked for the transaction.
interface LockedPoints {
  id: string;
  total: number;
}

const HISTORY_COLUMNS = `
  h.id_column AS id,
  h.accumulated_point_column AS accumulatedPointId,
  u.id_column AS userId,
  h.type_column AS type,
  h.status_column AS status,
  h.points_column AS points,
  h.last_points_column AS lastPoints,
  h.object_type_column AS objectType,
  h.object_id_column AS objectId,
  h.object_slug_column AS objectSlug,
  h.external_transaction_id_column AS externalTransactionId,
  h.expires_at_column AS expiresAt,
  h.created_at_column AS createdAt
  FROM accumulated_point_transaction_history_tbl h
  LEFT JOIN user_tbl u ON u.accumulated_point_column = h.accumulated_point_column`;

const toKeyedHistoryRow = (raw: any): KeyedHistoryRow => ({
  ...raw,
  points: Number(raw.points),
  lastPoints: Number(raw.lastPoints),
});

@Injectable()
export class AccumulatedPointService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(AccumulatedPoint)
    private readonly accumulatedPointRepository: Repository<AccumulatedPoint>,
    @InjectRepository(AccumulatedPointTransactionHistory)
    private readonly transactionHistoryRepository: Repository<AccumulatedPointTransactionHistory>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectMapper()
    private readonly mapper: Mapper,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
    private readonly systemConfigService: SystemConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async getAccumulatedPointsPercentage() {
    return (
      (await this.systemConfigService.get(
        SystemConfigKey.ACCUMULATED_POINTS_PERCENTAGE,
      )) || '0'
    );
  }

  /**
   * Get points history of user. Step 6.9 (QD17): GET /accumulated-point/history,
   * the self view, keyed by the user id of the token.
   */
  async getPointsHistory(
    userId: string,
    query: GetPointHistoryQueryDto,
  ): Promise<AppPaginatedResponseDto<PointTransactionHistoryResponseDto>> {
    const context = `${AccumulatedPointService.name}.${this.getPointsHistory.name}`;

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['accumulatedPoint', 'role'],
    });

    if (!user) {
      this.logger.error(`User not found: ${userId}`, context);
      throw new AccumulatedPointException(
        AccumulatedPointValidation.USER_NOT_FOUND,
      );
    }

    // Check if user is customer
    if (!isCustomer(user.role?.name)) {
      this.logger.log(`User is not customer: ${userId}`, context);
      throw new AccumulatedPointException(
        AccumulatedPointValidation.CUSTOMER_ONLY_FEATURE,
      );
    }

    // Check if user is default customer
    if (isDefaultCustomer(user.phonenumber)) {
      this.logger.warn(
        `Default customer cannot view points history: ${userId}`,
        context,
      );
      throw new AccumulatedPointException(
        AccumulatedPointValidation.DEFAULT_CUSTOMER_NOT_ELIGIBLE,
      );
    }

    if (!user.accumulatedPoint) {
      return {
        hasNext: false,
        hasPrevios: false,
        items: [],
        total: 0,
        page: query.hasPaging ? query.page : 1,
        pageSize: query.hasPaging ? query.size : 0,
        totalPages: 0,
      } as AppPaginatedResponseDto<PointTransactionHistoryResponseDto>;
    }

    // Construct where options
    const whereOptions: FindOptionsWhere<AccumulatedPointTransactionHistory> = {
      accumulatedPoint: {
        id: user.accumulatedPoint.id,
      },
      type: In([query.types]),
    };

    if (query.fromDate && query.toDate) {
      whereOptions.createdAt = Between(
        new Date(query.fromDate),
        new Date(query.toDate),
      );
    } else if (query.fromDate) {
      whereOptions.createdAt = Between(new Date(query.fromDate), new Date());
    } else if (query.toDate) {
      whereOptions.createdAt = Between(
        new Date('1970-01-01'),
        new Date(query.toDate),
      );
    }

    // Construct find many options
    const findManyOptions: FindManyOptions = {
      where: whereOptions,
      order: { date: 'DESC' },
    };

    if (query.hasPaging) {
      findManyOptions.skip = (query.page - 1) * query.size;
      findManyOptions.take = query.size;
    }

    const [transactions, total] =
      await this.transactionHistoryRepository.findAndCount(findManyOptions);

    // Calculate total pages
    const page = query.hasPaging ? query.page : 1;
    const pageSize = query.hasPaging ? query.size : total;
    const totalPages = Math.ceil(total / pageSize);

    // Determine hasNext and hasPrevious
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    // Map to response DTOs
    const items = transactions.map((transaction) => ({
      ...this.mapper.map(
        transaction,
        AccumulatedPointTransactionHistory,
        PointTransactionHistoryResponseDto,
      ),
      orderSlug: orderSlugOfRef(transaction.objectSlug),
    }));

    return {
      hasNext,
      hasPrevios: hasPrevious,
      items,
      total,
      page,
      pageSize,
      totalPages,
    } as AppPaginatedResponseDto<PointTransactionHistoryResponseDto>;
  }

  /**
   * Get total points of user. Step 6.9 (QD17): GET /accumulated-point/points,
   * the self view, keyed by the user id of the token.
   */
  async getTotalPointsOfUser(
    userId: string,
  ): Promise<AccumulatedPointResponseDto> {
    const context = `${AccumulatedPointService.name}.${this.getTotalPointsOfUser.name}`;

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['accumulatedPoint', 'role'],
    });

    if (!user) {
      this.logger.error(`User not found: ${userId}`, context);
      throw new AccumulatedPointException(
        AccumulatedPointValidation.USER_NOT_FOUND,
      );
    }

    // Check if user is customer
    if (!isCustomer(user.role?.name)) {
      this.logger.log(`User is not customer: ${userId}`, context);
      throw new AccumulatedPointException(
        AccumulatedPointValidation.CUSTOMER_ONLY_FEATURE,
      );
    }

    // Check if user is default customer
    if (isDefaultCustomer(user.phonenumber)) {
      this.logger.warn(
        `Default customer cannot accumulate points: ${userId}`,
        context,
      );
      throw new AccumulatedPointException(
        AccumulatedPointValidation.DEFAULT_CUSTOMER_NOT_ELIGIBLE,
      );
    }

    let accumulatedPoint = user.accumulatedPoint;

    // Create new if not exists, as the mono copy does, but with the creator
    // of step 6.7: it locks the user row, so a first /internal add running at
    // the same time shares the row, and it leaves updated_at alone.
    if (!accumulatedPoint) {
      const id = await this.pointsRowIdOf(user.id, true);
      accumulatedPoint = await this.accumulatedPointRepository.findOne({
        where: { id },
      });
    }

    return this.mapper.map(
      accumulatedPoint,
      AccumulatedPoint,
      AccumulatedPointResponseDto,
    );
  }

  /**
   * Add points for user after successful payment
   */
  async addPointsForOrder(addPointsDto: IAddPointsDto): Promise<void> {
    const context = `${AccumulatedPointService.name}.${this.addPointsForOrder.name}`;

    const user = await this.userRepository.findOne({
      where: { id: addPointsDto.userId },
      relations: ['accumulatedPoint', 'role'],
    });

    if (!user) {
      this.logger.error(`User not found: ${addPointsDto.userId}`, context);
      throw new AccumulatedPointException(
        AccumulatedPointValidation.USER_NOT_FOUND,
      );
    }

    // Check if user is customer
    if (!isCustomer(user.role?.name)) {
      this.logger.log(`User is not customer: ${addPointsDto.userId}`, context);
      return; // Don't add points for non-customer
    }

    // Check if user is default customer
    if (isDefaultCustomer(user.phonenumber)) {
      this.logger.log(
        `Default customer skipped for points accumulation: ${addPointsDto.userId}`,
        context,
      );
      return; // Don't add points for default customer
    }

    const pointsPercentage = await this.getAccumulatedPointsPercentage();

    const pointsToAdd = calculateAccumulatedPoints(
      addPointsDto.orderTotal,
      parseInt(pointsPercentage),
    );

    if (pointsToAdd <= 0) {
      this.logger.log(
        `No points to add for order: ${addPointsDto.orderId}`,
        context,
      );
      return;
    }

    let accumulatedPoint = user.accumulatedPoint;

    // Create new if not exists
    if (!accumulatedPoint) {
      accumulatedPoint = await this.createAccumulatedPointForUser(user);
    }

    const previousPoints = accumulatedPoint.totalPoints;
    accumulatedPoint.totalPoints += pointsToAdd;

    try {
      await this.accumulatedPointRepository.save(accumulatedPoint);

      // Create transaction history
      await this.createTransactionHistory({
        accumulatedPoint,
        orderId: addPointsDto.orderId,
        type: AccumulatedPointTransactionType.ADD,
        points: pointsToAdd,
        lastPoints: accumulatedPoint.totalPoints,
        status: AccumulatedPointTransactionStatus.CONFIRMED,
        createdUserId: null,
      });

      this.logger.log(
        `Added ${pointsToAdd} points for user ${user.id}, order ${addPointsDto.orderId}. Previous: ${previousPoints}, Current: ${accumulatedPoint.totalPoints}`,
        context,
      );
    } catch (error) {
      this.logger.error(
        `Error adding points: ${error.message}`,
        error.stack,
        context,
      );
      throw new AccumulatedPointException(
        AccumulatedPointValidation.ERROR_UPDATING_POINTS,
      );
    }
  }

  /**
   * Confirm points usage when order is paid successfully
   */
  async confirmPointsUsage(orderId: string): Promise<void> {
    const context = `${AccumulatedPointService.name}.${this.confirmPointsUsage.name}`;

    // Find reservation pending for this order
    const reservation = await this.transactionHistoryRepository.findOne({
      where: {
        objectType: ACCUMULATED_POINT_OBJECT_TYPE_ORDER,
        objectId: orderId,
        type: AccumulatedPointTransactionType.RESERVE,
        status: AccumulatedPointTransactionStatus.PENDING,
      },
      relations: ['accumulatedPoint'],
    });

    if (!reservation) {
      this.logger.log(`No reserved points found for order ${orderId}`, context);
      return; // No points to reserve, skip
    }

    const accumulatedPoint = reservation.accumulatedPoint;
    const pointsToUse = reservation.points;

    try {
      // Update reservation status to confirmed
      reservation.status = AccumulatedPointTransactionStatus.CONFIRMED;
      reservation.lastPoints = reservation.lastPoints;
      await this.transactionHistoryRepository.save(reservation);

      // Create record USE to tracking
      await this.createTransactionHistory({
        accumulatedPoint,
        orderId,
        type: AccumulatedPointTransactionType.USE,
        points: pointsToUse,
        lastPoints: reservation.lastPoints,
        status: AccumulatedPointTransactionStatus.CONFIRMED,
        createdUserId: null,
      });

      this.logger.log(
        `Confirmed ${pointsToUse} points usage for order ${orderId}. New balance: ${accumulatedPoint.totalPoints}`,
        context,
      );
    } catch (error) {
      this.logger.error(
        `Error confirming points usage: ${error.message}`,
        error.stack,
        context,
      );
      throw new AccumulatedPointException(
        AccumulatedPointValidation.ERROR_UPDATING_POINTS,
      );
    }
  }

  /**
   * Automatically handle when order is cancelled or expired
   * Cancel reservation if exists, refund points if confirmed
   */
  async handleCancelReservation(
    orderId: string,
    createdUserId?: string | null,
  ): Promise<void> {
    const context = `${AccumulatedPointService.name}.${this.handleCancelReservation.name}`;

    const reservation = await this.transactionHistoryRepository.findOne({
      where: {
        objectType: ACCUMULATED_POINT_OBJECT_TYPE_ORDER,
        objectId: orderId,
        type: AccumulatedPointTransactionType.RESERVE,
        status: AccumulatedPointTransactionStatus.PENDING,
      },
      relations: ['accumulatedPoint.user.role'],
    });

    if (!reservation) {
      this.logger.log(`No reserved points found for order ${orderId}`, context);
      return; // No points to reserve, skip
    }
    if (!reservation.accumulatedPoint) {
      this.logger.log(
        `No accumulated point found for order ${orderId}`,
        context,
      );
      return; // No points to reserve, skip
    }
    if (!reservation.accumulatedPoint.user) {
      this.logger.log(
        `No user found for accumulated point ${orderId}`,
        context,
      );
      return; // No points to reserve, skip
    }

    // Check if user is customer
    if (!isCustomer(reservation.accumulatedPoint.user.role?.name)) {
      this.logger.log(
        `User is not customer: ${reservation.accumulatedPoint.user.id}`,
        context,
      );
      return; // No points to reserve, skip
    }

    if (isDefaultCustomer(reservation.accumulatedPoint.user.phonenumber)) {
      this.logger.log(
        `Default customer cannot use points: ${orderId}`,
        context,
      );
      return; // No points to reserve, skip
    }

    // Refund points used
    const accumulatedPoint = reservation.accumulatedPoint;
    accumulatedPoint.totalPoints += reservation.points;

    await this.accumulatedPointRepository.save(accumulatedPoint);

    // cancel reservation
    reservation.status = AccumulatedPointTransactionStatus.CANCELLED;
    await this.transactionHistoryRepository.save(reservation);

    // Create refund transaction history
    await this.createTransactionHistory({
      accumulatedPoint,
      orderId,
      type: AccumulatedPointTransactionType.REFUND,
      points: reservation.points,
      lastPoints: accumulatedPoint.totalPoints,
      status: AccumulatedPointTransactionStatus.CONFIRMED,
      createdUserId,
    });

    this.logger.log(
      `Refunded ${reservation.points} confirmed points for cancelled/expired order ${orderId}`,
      context,
    );
  }

  /**
   * Create new accumulated point account for user
   */
  private async createAccumulatedPointForUser(
    user: User,
  ): Promise<AccumulatedPoint> {
    const context = `${AccumulatedPointService.name}.${this.createAccumulatedPointForUser.name}`;

    try {
      const accumulatedPoint = this.accumulatedPointRepository.create({
        user,
        totalPoints: 0,
      });

      const savedPoint =
        await this.accumulatedPointRepository.save(accumulatedPoint);
      this.logger.log(
        `Created accumulated point account for user ${user.id}`,
        context,
      );

      return savedPoint;
    } catch (error) {
      this.logger.error(
        `Error creating accumulated point account: ${error.message}`,
        error.stack,
        context,
      );
      throw new AccumulatedPointException(
        AccumulatedPointValidation.ERROR_CREATING_ACCUMULATED_POINT,
      );
    }
  }

  /**
   * Create transaction history
   */
  private async createTransactionHistory(data: {
    accumulatedPoint: AccumulatedPoint;
    orderId: string;
    type: AccumulatedPointTransactionType;
    points: number;
    lastPoints: number;
    status: AccumulatedPointTransactionStatus;
    createdUserId: string | null;
  }): Promise<void> {
    const context = `${AccumulatedPointService.name}.${this.createTransactionHistory.name}`;

    try {
      // Step 6.15: the wallet no longer maps Order; same row as the findOne it
      // replaces (soft deleted orders excluded).
      const [order] = (await this.transactionHistoryRepository.query(
        'SELECT id_column AS id, slug_column AS slug FROM order_tbl WHERE id_column = ? AND deleted_at_column IS NULL',
        [data.orderId],
      )) as { id: string; slug: string }[];

      const pointsPercentage = await this.getAccumulatedPointsPercentage();

      // Soft reference instead of the order relation (step 6.2): same values
      // as the backfill of migration v4.0.0-03, empty when the order is gone,
      // as the foreign key column used to be.
      const transaction = this.transactionHistoryRepository.create({
        accumulatedPoint: data.accumulatedPoint,
        objectType: order ? ACCUMULATED_POINT_OBJECT_TYPE_ORDER : null,
        objectId: order?.id ?? null,
        objectSlug: order ? legacyTrendOrderRef(order.slug) : null,
        type: data.type,
        points: data.points,
        lastPoints: data.lastPoints,
        currentPointsPercentage: parseInt(pointsPercentage),
        date: new Date(),
        status: data.status,
        createdBy: data.createdUserId,
      });

      await this.transactionHistoryRepository.save(transaction);
      this.logger.log(
        `Created transaction history: ${data.type} ${data.points} points`,
        context,
      );
    } catch (error) {
      this.logger.error(
        `Error creating transaction history: ${error.message}`,
        error.stack,
        context,
      );
      // Two reservations of one person for one service raced past the
      // findOne check of reservePointsForOrder: the unique index of step 6.4
      // let only one of them in. Same answer as the findOne check.
      if (
        (error?.code ?? error?.driverError?.code) === 'ER_DUP_ENTRY' &&
        String(error?.message).includes(ACTIVE_RESERVATION_INDEX)
      ) {
        throw new AccumulatedPointException(
          AccumulatedPointValidation.POINTS_ALREADY_RESERVED_FOR_OTHER_ORDER,
        );
      }
      throw new AccumulatedPointException(
        AccumulatedPointValidation.ERROR_CREATING_TRANSACTION_HISTORY,
      );
    }
  }

  /*
   * Internal routes (/internal/accumulated-points/*, step 6.7). The internal
   * layer resolves the user once by shared-user id. None of the business
   * checks of the methods above apply here (6A-3): no status of the caller's
   * object, no role, no default customer, no lookup of the object, no rate
   * (QD-T4). The calling service made those decisions. The wallet guarantees
   * three things: points never go below zero, a key is written once, and a
   * person holds at most one open reservation per calling service (QD-T3).
   *
   * Every write is one database transaction whose FIRST statement locks the
   * points row of the person (SELECT ... FOR UPDATE). All writes of one
   * person therefore run one after the other, and the plain reads that
   * follow the lock (key already written? open reservation of the service?)
   * see everything the previous holder committed: InnoDB takes the read view
   * of a transaction at its first plain read, which comes after the lock. The
   * unique indexes of steps 6.3 (key) and 6.4 (open reservation) are the
   * last fence. The step 6.8 job must take the same lock before it releases
   * a reservation.
   *
   * Points held by a reservation are taken out of total_points_column when it
   * is made (as the mono copy does), so the total is what can be spent now
   * ("total minus held", QD-T3) and a reservation is checked against it under
   * the lock.
   */

  async findInternalUser(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id }, select: { id: true } });
  }

  // Points of each existing user among userIds, in the order asked, 0 when
  // the user has no points row yet (no row is created on a read). Unknown
  // ids are left out.
  async lookupPointsByUserIds(
    userIds: string[],
  ): Promise<AccumulatedPointLookupResponse[]> {
    const ids = [...new Set(userIds)];
    const rows: { userId: string; points: number | null }[] =
      await this.userRepository
        .createQueryBuilder('u')
        .leftJoin('u.accumulatedPoint', 'ap')
        .select('u.id', 'userId')
        .addSelect('ap.totalPoints', 'points')
        .where('u.id IN (:...ids)', { ids })
        .getRawMany();
    const points = new Map(rows.map((r) => [r.userId, Number(r.points ?? 0)]));
    return ids
      .filter((id) => points.has(id))
      .map((id) => ({ userId: id, points: points.get(id) }));
  }

  // expiresAt of a reservation (QD11): the one sent, which must be in the
  // future and at most RESERVATION_MAX_TTL_MINUTES away, else now plus the
  // configured TTL.
  resolveReservationExpiry(expiresAt?: string): Date {
    const now = Date.now();
    const maxMs = RESERVATION_MAX_TTL_MINUTES * 60_000;
    if (expiresAt === undefined || expiresAt === null) {
      const configured = Number(
        this.configService.get<string>(RESERVATION_TTL_ENV),
      );
      const minutes =
        Number.isFinite(configured) && configured > 0
          ? configured
          : RESERVATION_DEFAULT_TTL_MINUTES;
      return new Date(now + Math.min(minutes * 60_000, maxMs));
    }
    const at = new Date(expiresAt);
    if (!(at.getTime() > now)) {
      throw new BadRequestException('expiresAt must be in the future');
    }
    if (at.getTime() > now + maxMs) {
      throw new BadRequestException(
        `expiresAt is at most ${RESERVATION_MAX_TTL_MINUTES} minutes away`,
      );
    }
    return at;
  }

  // Add exactly input.points (QD-T4), idempotent on input.transactionId. The
  // first add of a person creates the points row.
  async addByKey(
    userId: string,
    input: PointMoveInput & { pointsPercentage?: number },
  ): Promise<AccumulatedPointMoveResponse> {
    const key = input.transactionId;
    const expected: ReplayExpectation = {
      userId,
      type: AccumulatedPointTransactionType.ADD,
      points: input.points,
    };
    const recorded = await this.findHistoryByKey(key);
    if (recorded) return this.replayOf(recorded, expected);

    const pointsRowId = await this.pointsRowIdOf(userId, true);
    if (!pointsRowId) throw new NotFoundException('User not found');
    return this.writeByKey(key, expected, async (manager) => {
      const points = await this.lockPoints(manager, pointsRowId);
      if (await this.isKeyRecorded(manager, key)) return null;
      const total = await this.movePoints(manager, points, input.points, key);
      return this.insertHistory(manager, points.id, userId, {
        type: AccumulatedPointTransactionType.ADD,
        status: AccumulatedPointTransactionStatus.CONFIRMED,
        points: input.points,
        lastPoints: total,
        pointsPercentage: input.pointsPercentage,
        objectType: input.objectType,
        objectId: input.objectId,
        objectSlug: `${serviceOfRef(key)}:${input.objectSlug}`,
        key,
        expiresAt: null,
      });
    });
  }

  // Hold input.points for an object of the calling service until confirm,
  // cancel or expiresAt, idempotent on input.transactionId. The service is the
  // prefix of the key. An open reservation of the same service:
  // - for the same object (objectType + objectId): replaced, its points given
  //   back (K:cancel) before the new hold, in the same transaction;
  // - for another object, past its expiresAt: released the same way (what
  //   the step 6.8 job does, without waiting for its next run);
  // - for another object, still running: POINTS_ALREADY_RESERVED_FOR_OTHER_ORDER.
  // A reservation in another service does not count (QD-T3): its points are
  // already out of the total.
  async reserveByKey(
    userId: string,
    input: PointMoveInput,
    expiresAt: Date,
  ): Promise<AccumulatedPointMoveResponse> {
    const key = input.transactionId;
    const service = serviceOfRef(key);
    const expected: ReplayExpectation = {
      userId,
      type: AccumulatedPointTransactionType.RESERVE,
      points: input.points,
      objectType: input.objectType,
      objectId: input.objectId,
    };
    const recorded = await this.findHistoryByKey(key);
    if (recorded) return this.replayOf(recorded, expected);

    // No points row: nothing to hold (a read or a reserve never creates one).
    const pointsRowId = await this.pointsRowIdOf(userId, false);
    if (!pointsRowId) {
      throw new AccumulatedPointException(
        AccumulatedPointValidation.INSUFFICIENT_POINTS,
      );
    }
    return this.writeByKey(key, expected, async (manager) => {
      const points = await this.lockPoints(manager, pointsRowId);
      if (await this.isKeyRecorded(manager, key)) return null;
      const open = await this.findOpenReservation(manager, points.id, service);
      if (open) {
        const sameObject =
          open.objectType === input.objectType &&
          open.objectId === input.objectId;
        const expired =
          open.expiresAt !== null &&
          new Date(open.expiresAt).getTime() <= Date.now();
        if (!sameObject && !expired) {
          throw new AccumulatedPointException(
            AccumulatedPointValidation.POINTS_ALREADY_RESERVED_FOR_OTHER_ORDER,
          );
        }
        await this.releaseReservation(manager, points, open);
      }
      if (points.total < input.points) {
        throw new AccumulatedPointException(
          AccumulatedPointValidation.INSUFFICIENT_POINTS,
        );
      }
      const total = await this.movePoints(manager, points, -input.points, key);
      return this.insertHistory(manager, points.id, userId, {
        type: AccumulatedPointTransactionType.RESERVE,
        status: AccumulatedPointTransactionStatus.PENDING,
        points: input.points,
        lastPoints: total,
        objectType: input.objectType,
        objectId: input.objectId,
        objectSlug: `${service}:${input.objectSlug}`,
        key,
        expiresAt,
      });
    });
  }

  // Spend the points of the reservation K (they already left the total when
  // it was made): the reservation becomes confirmed and the row K:confirm
  // (type use) records it. Confirming twice confirms once.
  async confirmReservationByKey(
    reservationKey: string,
  ): Promise<AccumulatedPointMoveResponse> {
    const reservation = await this.findReservationByKey(reservationKey);
    const key = `${reservationKey}${RESERVATION_CONFIRM_SUFFIX}`;
    const expected: ReplayExpectation = {
      userId: reservation.userId,
      type: AccumulatedPointTransactionType.USE,
      points: reservation.points,
    };
    const recorded = await this.findHistoryByKey(key);
    if (recorded) return this.replayOf(recorded, expected);

    return this.writeByKey(key, expected, async (manager) => {
      const points = await this.lockPoints(
        manager,
        reservation.accumulatedPointId,
      );
      if (await this.isKeyRecorded(manager, key)) return null;
      await this.closeReservation(
        manager,
        reservation,
        AccumulatedPointTransactionStatus.CONFIRMED,
      );
      return this.insertHistory(manager, points.id, reservation.userId, {
        type: AccumulatedPointTransactionType.USE,
        status: AccumulatedPointTransactionStatus.CONFIRMED,
        points: reservation.points,
        lastPoints: points.total,
        objectType: reservation.objectType,
        objectId: reservation.objectId,
        objectSlug: reservation.objectSlug,
        key,
        expiresAt: null,
      });
    });
  }

  // Give the points of the reservation K back: the reservation becomes
  // cancelled and the row K:cancel (type refund) adds them to the total.
  // Cancelling twice gives back once.
  async cancelReservationByKey(
    reservationKey: string,
  ): Promise<AccumulatedPointMoveResponse> {
    const reservation = await this.findReservationByKey(reservationKey);
    const key = `${reservationKey}${RESERVATION_CANCEL_SUFFIX}`;
    const expected: ReplayExpectation = {
      userId: reservation.userId,
      type: AccumulatedPointTransactionType.REFUND,
      points: reservation.points,
    };
    const recorded = await this.findHistoryByKey(key);
    if (recorded) return this.replayOf(recorded, expected);

    return this.writeByKey(key, expected, async (manager) => {
      const points = await this.lockPoints(
        manager,
        reservation.accumulatedPointId,
      );
      if (await this.isKeyRecorded(manager, key)) return null;
      return this.releaseReservation(manager, points, reservation);
    });
  }

  // Step 6.8 (QD11): release the open reservations whose expiresAt is at or
  // before expiresAtBefore, of every calling service (no prefix filter: this
  // job replaces the balance schedulers of all consumers). Rows without
  // expiresAt (mono copy, backfill) never expire. Candidates come from the
  // unique index of open reservations (step 6.4), so the query reads open
  // reservations only, not the whole history.
  //
  // Each reservation is released in its own transaction that locks the points
  // row first and checks again under that lock that the reservation is still
  // open and expired: a confirm or cancel that got the lock first wins, and
  // two replicas running the job release a reservation once. The release is
  // the one of cancel-reservation (K:cancel, points given back), so a later
  // cancel-reservation with K is a replay and a later confirm a 409. Returns
  // the keys released (the row id for a reservation without key).
  async releaseExpiredReservations(
    expiresAtBefore: Date,
    limit = 200,
  ): Promise<string[]> {
    const context = `${AccumulatedPointService.name}.${this.releaseExpiredReservations.name}`;
    const due: KeyedHistoryRow[] = (
      await this.dataSource.query(
        `SELECT ${HISTORY_COLUMNS} WHERE h.active_reservation_key_column IS NOT NULL AND h.expires_at_column <= ? ORDER BY h.expires_at_column LIMIT ?`,
        [expiresAtBefore, limit],
      )
    ).map(toKeyedHistoryRow);

    const released: string[] = [];
    for (const reservation of due) {
      const name = reservation.externalTransactionId ?? reservation.id;
      try {
        const done = await this.dataSource.transaction(async (manager) => {
          const points = await this.lockPoints(
            manager,
            reservation.accumulatedPointId,
          );
          const [still] = await manager.query(
            'SELECT id_column AS id FROM accumulated_point_transaction_history_tbl WHERE id_column = ? AND type_column = ? AND status_column = ? AND deleted_at_column IS NULL AND expires_at_column <= ?',
            [
              reservation.id,
              AccumulatedPointTransactionType.RESERVE,
              AccumulatedPointTransactionStatus.PENDING,
              expiresAtBefore,
            ],
          );
          if (!still) return false;
          await this.releaseReservation(manager, points, reservation);
          return true;
        });
        if (done) released.push(name);
      } catch (error) {
        // One reservation that cannot be released must not stop the others;
        // it is tried again on the next run.
        this.logger.error(
          `Error releasing expired reservation ${name}: ${error.message}`,
          error.stack,
          context,
        );
      }
    }
    return released;
  }

  // Close an open reservation and give its points back, writing the refund
  // row K:cancel (no key for a reservation of the mono copy, which has
  // none). Every way a keyed reservation ends cancelled (cancel-reservation,
  // replaced by a new one, expired) writes K:cancel, so a later
  // cancel-reservation with K is a replay. Runs under the lock of the points
  // row.
  private async releaseReservation(
    manager: EntityManager,
    points: LockedPoints,
    reservation: KeyedHistoryRow,
  ): Promise<KeyedHistoryRow> {
    await this.closeReservation(
      manager,
      reservation,
      AccumulatedPointTransactionStatus.CANCELLED,
    );
    const key = reservation.externalTransactionId
      ? `${reservation.externalTransactionId}${RESERVATION_CANCEL_SUFFIX}`
      : null;
    const total = await this.movePoints(
      manager,
      points,
      reservation.points,
      key,
    );
    return this.insertHistory(manager, points.id, reservation.userId, {
      type: AccumulatedPointTransactionType.REFUND,
      status: AccumulatedPointTransactionStatus.CONFIRMED,
      points: reservation.points,
      lastPoints: total,
      objectType: reservation.objectType,
      objectId: reservation.objectId,
      objectSlug: reservation.objectSlug,
      key,
      expiresAt: null,
    });
  }

  // reserve -> confirmed or cancelled, only from pending: a reservation that
  // is already closed is a 409, never closed twice.
  private async closeReservation(
    manager: EntityManager,
    reservation: KeyedHistoryRow,
    status: AccumulatedPointTransactionStatus,
  ): Promise<void> {
    const updated = await manager.query(
      'UPDATE accumulated_point_transaction_history_tbl SET status_column = ? WHERE id_column = ? AND type_column = ? AND status_column = ?',
      [
        status,
        reservation.id,
        AccumulatedPointTransactionType.RESERVE,
        AccumulatedPointTransactionStatus.PENDING,
      ],
    );
    if (updated?.affectedRows !== 1) {
      const [current] = await manager.query(
        'SELECT status_column AS status FROM accumulated_point_transaction_history_tbl WHERE id_column = ?',
        [reservation.id],
      );
      throw new ConflictException(
        `Reservation ${reservation.externalTransactionId ?? reservation.id} is ${current?.status ?? 'gone'}, not pending`,
      );
    }
  }

  // The points row of a user, by the link on user_tbl. With create, a user
  // without one gets it: in its own transaction that locks the user row
  // first, so two first adds share one row. user_tbl.updated_at_column is
  // left as it is: the link is not identity data, and /internal/users/
  // list-recent reads that column.
  private async pointsRowIdOf(
    userId: string,
    create: boolean,
  ): Promise<string | null> {
    const [link] = await this.dataSource.query(
      'SELECT accumulated_point_column AS id FROM user_tbl WHERE id_column = ?',
      [userId],
    );
    if (!link) return null;
    if (link.id || !create) return link.id ?? null;
    return this.dataSource.transaction(async (manager) => {
      const [locked] = await manager.query(
        'SELECT accumulated_point_column AS id FROM user_tbl WHERE id_column = ? FOR UPDATE',
        [userId],
      );
      if (!locked) return null;
      if (locked.id) return locked.id;
      const created = await manager.save(
        manager.create(AccumulatedPoint, { totalPoints: 0 }),
      );
      await manager.query(
        'UPDATE user_tbl SET accumulated_point_column = ?, updated_at_column = updated_at_column WHERE id_column = ?',
        [created.id, userId],
      );
      return created.id;
    });
  }

  // First statement of every write transaction (see the comment above
  // findInternalUser).
  private async lockPoints(
    manager: EntityManager,
    pointsRowId: string,
  ): Promise<LockedPoints> {
    const [row] = await manager.query(
      'SELECT id_column AS id, total_points_column AS total FROM accumulated_point_tbl WHERE id_column = ? FOR UPDATE',
      [pointsRowId],
    );
    if (!row) {
      throw new AccumulatedPointException(
        AccumulatedPointValidation.ACCUMULATED_POINT_NOT_FOUND,
      );
    }
    return { id: row.id, total: Number(row.total) };
  }

  // Add delta to the total with an UPDATE on the column (no read-modify-save
  // of the entity); the WHERE refuses a negative result. The points row keeps
  // the key of the last transaction written to it (step 6.3).
  private async movePoints(
    manager: EntityManager,
    points: LockedPoints,
    delta: number,
    key: string | null,
  ): Promise<number> {
    const updated = await manager.query(
      'UPDATE accumulated_point_tbl SET total_points_column = total_points_column + ?, external_transaction_id_column = COALESCE(?, external_transaction_id_column) WHERE id_column = ? AND total_points_column + ? >= 0',
      [delta, key, points.id, delta],
    );
    if (updated?.affectedRows !== 1) {
      throw new AccumulatedPointException(
        AccumulatedPointValidation.INSUFFICIENT_POINTS,
      );
    }
    points.total += delta;
    return points.total;
  }

  private async isKeyRecorded(
    manager: EntityManager,
    key: string,
  ): Promise<boolean> {
    const [row] = await manager.query(
      'SELECT id_column AS id FROM accumulated_point_transaction_history_tbl WHERE external_transaction_id_column = ?',
      [key],
    );
    return !!row;
  }

  // The open reservation (reserve, pending, not deleted) of a person for one
  // service, through the generated column of step 6.4 and its unique index.
  private async findOpenReservation(
    manager: EntityManager,
    pointsRowId: string,
    service: string,
  ): Promise<KeyedHistoryRow | null> {
    const [row] = await manager.query(
      `SELECT ${HISTORY_COLUMNS} WHERE h.active_reservation_key_column = ?`,
      [`${pointsRowId}:${service}`],
    );
    return row ? toKeyedHistoryRow(row) : null;
  }

  private async findHistoryByKey(key: string): Promise<KeyedHistoryRow | null> {
    const [row] = await this.dataSource.query(
      `SELECT ${HISTORY_COLUMNS} WHERE h.external_transaction_id_column = ?`,
      [key],
    );
    return row ? toKeyedHistoryRow(row) : null;
  }

  // The reservation a confirm / cancel-reservation names: 404 when the key
  // was never written, 409 when it is not a reservation.
  private async findReservationByKey(key: string): Promise<KeyedHistoryRow> {
    const row = await this.findHistoryByKey(key);
    if (!row || !row.userId) {
      throw new NotFoundException(`Reservation ${key} not found`);
    }
    if (row.type !== AccumulatedPointTransactionType.RESERVE) {
      throw new ConflictException(`Transaction ${key} is not a reservation`);
    }
    return row;
  }

  private async insertHistory(
    manager: EntityManager,
    pointsRowId: string,
    userId: string,
    data: {
      type: AccumulatedPointTransactionType;
      status: AccumulatedPointTransactionStatus;
      points: number;
      lastPoints: number;
      pointsPercentage?: number;
      objectType: string | null;
      objectId: string | null;
      objectSlug: string | null;
      key: string | null;
      expiresAt: Date | null;
    },
  ): Promise<KeyedHistoryRow> {
    const saved = await manager.save(
      manager.create(AccumulatedPointTransactionHistory, {
        accumulatedPoint: { id: pointsRowId } as AccumulatedPoint,
        type: data.type,
        status: data.status,
        points: data.points,
        lastPoints: data.lastPoints,
        currentPointsPercentage: data.pointsPercentage ?? 0,
        date: new Date(),
        objectType: data.objectType,
        objectId: data.objectId,
        objectSlug: data.objectSlug,
        externalTransactionId: data.key ?? undefined,
        expiresAt: data.expiresAt ?? undefined,
      }),
    );
    return {
      id: saved.id,
      accumulatedPointId: pointsRowId,
      userId,
      type: data.type,
      status: data.status,
      points: data.points,
      lastPoints: data.lastPoints,
      objectType: data.objectType,
      objectId: data.objectId,
      objectSlug: data.objectSlug,
      externalTransactionId: data.key,
      expiresAt: data.expiresAt,
      createdAt: saved.createdAt,
    };
  }

  // Run one keyed write. work returns null when it finds its key already
  // written under the lock, and a request that loses the race on a unique
  // key index rolls back: both are answered as a replay of the row written
  // under that key. A lost race on the open reservation index (possible only
  // against the unlocked mono copy path) keeps the code of the check.
  private async writeByKey(
    key: string,
    expected: ReplayExpectation,
    work: (manager: EntityManager) => Promise<KeyedHistoryRow | null>,
  ): Promise<AccumulatedPointMoveResponse> {
    const context = `${AccumulatedPointService.name}.${this.writeByKey.name}`;
    let raced: any = null;
    try {
      const row = await this.dataSource.transaction(work);
      if (row) {
        this.logger.log(
          `${row.type} ${row.points} points for user ${row.userId}, key ${key}, total ${row.lastPoints}`,
          context,
        );
        return this.toMoveResponse(row, false);
      }
    } catch (error) {
      if (isDuplicateKey(error, ACTIVE_RESERVATION_INDEX)) {
        throw new AccumulatedPointException(
          AccumulatedPointValidation.POINTS_ALREADY_RESERVED_FOR_OTHER_ORDER,
        );
      }
      if (
        !isDuplicateKey(error, HISTORY_KEY_INDEX) &&
        !isDuplicateKey(error, POINTS_KEY_INDEX)
      ) {
        if (!(error instanceof HttpException)) {
          this.logger.error(
            `Error writing points with key ${key}: ${error.message}`,
            error.stack,
            context,
          );
        }
        throw error;
      }
      raced = error;
    }
    const winner = await this.findHistoryByKey(key);
    if (!winner) throw raced;
    return this.replayOf(winner, expected);
  }

  // Same key again: the row already written, unless the key was used for
  // something else (another user, another kind of write, another amount, or
  // for a reservation another object), a bug of the caller that must not
  // pass as a replay. A reservation that is no longer open (confirmed,
  // cancelled, replaced, expired) is a 409 too: a new reservation needs a new
  // key, or the caller would believe it holds points it does not.
  private replayOf(
    row: KeyedHistoryRow,
    expected: ReplayExpectation,
  ): AccumulatedPointMoveResponse {
    const sameTransaction =
      row.userId === expected.userId &&
      row.type === expected.type &&
      row.points === expected.points &&
      (expected.objectType === undefined ||
        (row.objectType === expected.objectType &&
          row.objectId === expected.objectId));
    if (!sameTransaction) {
      throw new ConflictException(
        `transactionId ${row.externalTransactionId} is already recorded for a different transaction`,
      );
    }
    if (
      row.type === AccumulatedPointTransactionType.RESERVE &&
      row.status !== AccumulatedPointTransactionStatus.PENDING
    ) {
      throw new ConflictException(
        `transactionId ${row.externalTransactionId} is a reservation that is already ${row.status}; a new reservation needs a new transactionId`,
      );
    }
    return this.toMoveResponse(row, true);
  }

  private toMoveResponse(
    row: KeyedHistoryRow,
    replayed: boolean,
  ): AccumulatedPointMoveResponse {
    return {
      transactionId: row.externalTransactionId,
      userId: row.userId,
      type: row.type,
      status: row.status,
      points: row.points,
      totalPoints: row.lastPoints,
      objectType: row.objectType,
      objectId: row.objectId,
      objectSlug: orderSlugOfRef(row.objectSlug) ?? null,
      expiresAt: row.expiresAt ?? null,
      replayed,
      createdAt: row.createdAt,
    };
  }
}
