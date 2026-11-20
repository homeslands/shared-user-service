import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PointTransaction } from './entities/point-transaction.entity';
import {
  Between,
  FindOptionsWhere,
  Like,
  MoreThan,
  Raw,
  Repository,
} from 'typeorm';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { InjectMapper } from '@automapper/nestjs';
import { Mapper } from '@automapper/core';
import {
  AnalysisPointTransactionResponseDto,
  AnalysisPointTransactionStatisticItemDto,
  PointTransactionResponseDto,
  PointTransactionStatisticItemDto,
} from './dto/point-transaction-response.dto';
import { createSortOptions } from 'src/shared/utils/obj.util';
import { AppPaginatedResponseDto } from 'src/app/app.dto';
import { FindAllPointTransactionDto } from './dto/find-all-point-transaction.dto';
import {
  PointTransactionGroupBy,
  PointTransactionTypeEnum,
} from './entities/point-transaction.enum';
import { User } from 'src/user/user.entity';
import _ from 'lodash';

// Which transactions a read covers (steps 6.9 and 6.10, QD17 + QD-T5).
// - userId: the transactions of that user, whatever service wrote them. The
//   self view always sets it, from the token.
// - service: the transactions written under that service's keys
//   ('<service>:...', the step 6.3 key). The view on behalf of a service of
//   the whole system sets it, from x-internal-service: the soft reference of a
//   row (objectSlug, objectType) only means something to the service that
//   wrote it. A row without key (mono copy, before the step 6.12 backfill
//   gives it one) belongs to no service and only shows in a per-user read.
// Neither: every transaction (only the client analysis route kept until 6.10
// did that).
export interface PointTransactionScope {
  userId?: string;
  service?: string;
}

// The service of a row: the prefix of its key, null for a row without key.
export const serviceOfTransactionKey = (
  key: string | null | undefined,
): string | null => (key && key.includes(':') ? key.split(':')[0] : null);

// LIKE pattern of the keys of a service: the service name is a header value,
// so its wildcards are escaped (MySQL's default escape character).
const keysOfService = (service: string): string =>
  `${service.replace(/[\\%_]/g, '\\$&')}:%`;

// Step 6.10: the most rows /internal/point-transactions/export answers with.
// Above it the caller is told to narrow the filter instead of getting a
// truncated file (the old client route built the whole file in one go).
export const POINT_TRANSACTION_EXPORT_MAX_ROWS = 20000;

@Injectable()
export class PointTransactionService {
  constructor(
    @InjectRepository(PointTransaction)
    private ptRepository: Repository<PointTransaction>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
    @InjectMapper()
    private readonly mapper: Mapper,
  ) {}

  // Step 6.10: POST /internal/point-transactions/analysis (QD-T5 scope).
  async analyze(
    req: FindAllPointTransactionDto,
    scope: PointTransactionScope = {},
  ) {
    const { sort } = req;

    const whereOpts: FindOptionsWhere<PointTransaction> =
      this.buildWhereOptions(req, scope);

    const sortOpts = createSortOptions<PointTransaction>(sort);

    const [pts, statistics] = await Promise.all([
      this.ptRepository.find({
        where: whereOpts,
        order: sortOpts,
        relations: ['user'],
        select: ['points', 'type'],
      }),
      this.getAnalysisStatistics(req, scope),
    ]);

    const totalEarned = pts
      .filter((item) => item.type === PointTransactionTypeEnum.IN)
      .reduce((prev, curr) => prev + curr?.points, 0);
    const totalSpent = pts
      .filter((item) => item.type === PointTransactionTypeEnum.OUT)
      .reduce((prev, curr) => prev + curr?.points, 0);
    const netDifference = Math.abs(totalEarned - totalSpent);

    const result = new AnalysisPointTransactionResponseDto();

    Object.assign(result, {
      totalEarned,
      totalSpent,
      netDifference,
      statistics,
    });
    return result;
  }

  // scope.userId (step 6.9) is the base of the user filter and is spread into
  // both branches of the k search below, so k narrows the owner's rows and can
  // never replace the filter (the mono copy assigned the k branches over the
  // user slug filter). scope.service (step 6.10) filters on the key prefix.
  private buildWhereOptions(
    req: FindAllPointTransactionDto,
    scope: PointTransactionScope = {},
  ): FindOptionsWhere<PointTransaction> {
    const { userId, service } = scope;
    const whereOpts: FindOptionsWhere<PointTransaction> = {};

    if (service) {
      whereOpts.externalTransactionId = Like(keysOfService(service));
    }

    let userWhere: FindOptionsWhere<User> | FindOptionsWhere<User>[] = userId
      ? { id: userId }
      : {};

    if (req.type) {
      whereOpts.type = req.type;
    }

    if (req.startDate && !req.endDate) {
      whereOpts.createdAt = MoreThan(req.startDate);
    }

    if (req.startDate && req.endDate) {
      whereOpts.createdAt = Between(req.startDate, req.endDate);
    }

    if (req.k) {
      userWhere = [
        {
          ...userWhere,
          phonenumber: Like(`%${req.k}%`),
        },
        {
          ...userWhere,
          firstName: Raw(
            (alias) =>
              `LOWER(CONCAT(${alias}, ' ', last_name_column)) LIKE LOWER(:q)`,
            { q: `%${req.k}%` },
          ),
        },
      ];
    }

    if (!_.isEmpty(userWhere)) {
      whereOpts.user = userWhere;
    }

    return whereOpts;
  }

  // Bucket start of the transaction created time, formatted like /user/statistics
  private buildGroupByExpr(groupBy: string): string {
    const col = 'pt.created_at_column';
    switch (groupBy) {
      case PointTransactionGroupBy.HOUR:
        return `DATE_FORMAT(${col}, '%Y-%m-%dT%H:00:00')`;
      case PointTransactionGroupBy.WEEK:
        return `DATE_FORMAT(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY), '%Y-%m-%dT00:00:00')`;
      case PointTransactionGroupBy.MONTH:
        return `DATE_FORMAT(${col}, '%Y-%m-01T00:00:00')`;
      case PointTransactionGroupBy.YEAR:
        return `DATE_FORMAT(${col}, '%Y-01-01T00:00:00')`;
      default:
        return `DATE_FORMAT(${col}, '%Y-%m-%dT00:00:00')`;
    }
  }

  // Transaction counts bucketed by time type, using the same filters as findAll
  private async getStatistics(
    req: FindAllPointTransactionDto,
    scope: PointTransactionScope = {},
  ): Promise<PointTransactionStatisticItemDto[]> {
    const { userId, service } = scope;
    const groupByExpr = this.buildGroupByExpr(req.groupBy);

    const qb = this.ptRepository
      .createQueryBuilder('pt')
      .leftJoin('pt.user', 'user')
      .select(groupByExpr, 'time')
      .addSelect('pt.type_column', 'type')
      .addSelect('COUNT(pt.id_column)', 'count')
      .groupBy(groupByExpr)
      .addGroupBy('pt.type_column')
      .orderBy(groupByExpr, 'ASC');

    if (userId) {
      qb.andWhere('user.id_column = :userId', { userId });
    }

    if (service) {
      qb.andWhere('pt.external_transaction_id_column LIKE :keys', {
        keys: keysOfService(service),
      });
    }

    if (req.type) {
      qb.andWhere('pt.type_column = :type', { type: req.type });
    }

    if (req.startDate && !req.endDate) {
      qb.andWhere('pt.created_at_column > :fromDate', {
        fromDate: req.startDate,
      });
    }

    if (req.startDate && req.endDate) {
      qb.andWhere('pt.created_at_column BETWEEN :fromDate AND :toDate', {
        fromDate: req.startDate,
        toDate: req.endDate,
      });
    }

    if (req.k) {
      qb.andWhere(
        `(user.phonenumber_column LIKE :k OR LOWER(CONCAT(user.first_name_column, ' ', user.last_name_column)) LIKE LOWER(:k))`,
        { k: `%${req.k}%` },
      );
    }

    const rows = await qb.getRawMany<{
      time: string;
      type: string;
      count: string;
    }>();
    return rows.map((row) => ({
      time: String(row.time),
      type: String(row.type),
      count: Number(row.count),
    }));
  }

  // Points earned/spent and transaction counts bucketed by time, for the analysis endpoint
  private async getAnalysisStatistics(
    req: FindAllPointTransactionDto,
    scope: PointTransactionScope = {},
  ): Promise<AnalysisPointTransactionStatisticItemDto[]> {
    const { userId, service } = scope;
    const groupByExpr = this.buildGroupByExpr(req.groupBy);

    const qb = this.ptRepository
      .createQueryBuilder('pt')
      .leftJoin('pt.user', 'user')
      .select(groupByExpr, 'time')
      .addSelect('COUNT(pt.id_column)', 'count')
      .addSelect(
        `SUM(CASE WHEN pt.type_column = :inType THEN pt.points_column ELSE 0 END)`,
        'earn',
      )
      .addSelect(
        `SUM(CASE WHEN pt.type_column = :outType THEN pt.points_column ELSE 0 END)`,
        'spend',
      )
      .setParameters({
        inType: PointTransactionTypeEnum.IN,
        outType: PointTransactionTypeEnum.OUT,
      })
      .groupBy(groupByExpr)
      .orderBy(groupByExpr, 'ASC');

    if (userId) {
      qb.andWhere('user.id_column = :userId', { userId });
    }

    if (service) {
      qb.andWhere('pt.external_transaction_id_column LIKE :keys', {
        keys: keysOfService(service),
      });
    }

    if (req.type) {
      qb.andWhere('pt.type_column = :type', { type: req.type });
    }

    if (req.startDate && !req.endDate) {
      qb.andWhere('pt.created_at_column > :fromDate', {
        fromDate: req.startDate,
      });
    }

    if (req.startDate && req.endDate) {
      qb.andWhere('pt.created_at_column BETWEEN :fromDate AND :toDate', {
        fromDate: req.startDate,
        toDate: req.endDate,
      });
    }

    if (req.k) {
      qb.andWhere(
        `(user.phonenumber_column LIKE :k OR LOWER(CONCAT(user.first_name_column, ' ', user.last_name_column)) LIKE LOWER(:k))`,
        { k: `%${req.k}%` },
      );
    }

    const rows = await qb.getRawMany<{
      time: string;
      count: string;
      earn: string;
      spend: string;
    }>();
    return rows.map((row) => ({
      time: String(row.time),
      count: Number(row.count),
      earn: Number(row.earn),
      spend: Number(row.spend),
    }));
  }

  // Step 6.9 (QD17): GET /point-transaction, the self view. userId is the one
  // of the token and is required: the list and the statistics only ever read
  // the transactions of that user.
  async findAll(req: FindAllPointTransactionDto, userId: string) {
    return this.findPage(req, { userId });
  }

  // Step 6.10 (QD17 + QD-T5): POST /internal/point-transactions/query, the
  // view on behalf of a calling service, which checked the role before. The
  // same page as the self view, and each row also carries the service that
  // wrote it, so the caller only opens the soft reference of its own rows.
  async findPageForService(
    req: FindAllPointTransactionDto,
    scope: PointTransactionScope,
  ) {
    return this.findPage(req, scope, true);
  }

  private async findPage(
    req: FindAllPointTransactionDto,
    scope: PointTransactionScope,
    withService = false,
  ) {
    const context = `${PointTransactionService.name}.${this.findPage.name}`;
    this.logger.log(
      `Find point transactions of ${JSON.stringify(scope)}: ${JSON.stringify(req)}`,
      context,
    );

    const { page, size, sort } = req;

    const whereOpts: FindOptionsWhere<PointTransaction> =
      this.buildWhereOptions(req, scope);

    const sortOpts = createSortOptions<PointTransaction>(sort);

    const [[pts, total], statistics] = await Promise.all([
      this.ptRepository.findAndCount({
        where: whereOpts,
        order: sortOpts,
        take: size,
        skip: (page - 1) * size,
        relations: ['user'],
      }),
      this.getStatistics(req, scope),
    ]);
    const mapped = this.mapper.mapArray(
      pts,
      PointTransaction,
      PointTransactionResponseDto,
    );
    const cardsResponse = withService
      ? mapped.map((item, i) => ({
          ...item,
          service: serviceOfTransactionKey(pts[i].externalTransactionId),
        }))
      : mapped;
    // Calculate total pages
    const totalPages = Math.ceil(total / size);
    // Determine hasNext and hasPrevious
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    return {
      hasNext: hasNext,
      hasPrevios: hasPrevious,
      items: cardsResponse,
      total,
      page: page,
      pageSize: size,
      totalPages,
      statistics,
    } as AppPaginatedResponseDto<PointTransactionResponseDto> & {
      statistics: PointTransactionStatisticItemDto[];
    };
  }

  // Step 6.10: POST /internal/point-transactions/export. The rows of the old
  // client exports (/export of a user, /export/system, /:slug/export of one
  // transaction), as data: the calling service builds its spreadsheet or its
  // receipt, as only it can resolve the soft reference (order, gift card,
  // campaign) of its own rows. Oldest first, like the old spreadsheets. Above
  // POINT_TRANSACTION_EXPORT_MAX_ROWS the request is refused, not truncated.
  async exportRows(
    filter: {
      slug?: string;
      type?: string;
      fromDate?: Date;
      toDate?: Date;
    },
    scope: PointTransactionScope,
  ) {
    const context = `${PointTransactionService.name}.${this.exportRows.name}`;
    const where: FindOptionsWhere<PointTransaction> = {};
    if (scope.userId) where.user = { id: scope.userId };
    if (scope.service) {
      where.externalTransactionId = Like(keysOfService(scope.service));
    }
    if (filter.slug) where.slug = filter.slug;
    if (filter.type) where.type = filter.type;
    if (filter.fromDate && !filter.toDate) {
      where.createdAt = MoreThan(filter.fromDate);
    }
    if (filter.fromDate && filter.toDate) {
      where.createdAt = Between(filter.fromDate, filter.toDate);
    }

    const total = await this.ptRepository.count({ where });
    this.logger.log(
      `Export point transactions of ${JSON.stringify(scope)} ${JSON.stringify(filter)}: ${total} row(s)`,
      context,
    );
    if (total > POINT_TRANSACTION_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `${total} point transactions match, more than the ${POINT_TRANSACTION_EXPORT_MAX_ROWS} an export answers with: narrow the filter (dates, type, user)`,
      );
    }

    const pts = await this.ptRepository.find({
      where,
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
    const items = this.mapper
      .mapArray(pts, PointTransaction, PointTransactionResponseDto)
      .map((item, i) => ({
        ...item,
        service: serviceOfTransactionKey(pts[i].externalTransactionId),
      }));
    return { items, total };
  }
}
