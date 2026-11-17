import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Balance } from './entities/balance.entity';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { FindByFieldDto } from './dto/find-by-field.dto';
import { InjectMapper } from '@automapper/nestjs';
import { Mapper } from '@automapper/core';
import {
  BalanceResponseDto,
  MaxBalanceResponseDto,
} from './dto/balance-response.dto';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { BalanceException } from './balance.exception';
import { BalanceValidation } from './balance.validation';
import { TransactionManagerService } from 'src/db/transaction-manager.service';
import { User } from 'src/user/user.entity';
import { AuthException } from 'src/auth/auth.exception';
import { AuthValidation } from 'src/auth/auth.validation';
import { PointTransaction } from '../point-transaction/entities/point-transaction.entity';
import { PointTransactionTypeEnum } from '../point-transaction/entities/point-transaction.enum';
import {
  BalanceCreditResponse,
  BalanceLookupResponse,
} from './internal/balance-internal.dto';

// Unique index on the idempotency key of the xu ledger and of the balance row
// (step 6.3, migration v4.0.0-04).
const LEDGER_KEY_INDEX = 'UQ_point_transaction_external_transaction_id';
const BALANCE_KEY_INDEX = 'UQ_balance_external_transaction_id';

const isDuplicateKey = (error: any, index?: string): boolean =>
  (error?.code ?? error?.driverError?.code) === 'ER_DUP_ENTRY' &&
  (!index || String(error?.message).includes(index));

// A credit of /internal/balance/credit (step 6.5): the key of the calling
// service and the soft reference of its object, stored on the ledger row.
export interface WalletCreditInput {
  points: number;
  transactionId: string;
  objectType: string;
  objectId: string;
  objectSlug: string;
  desc?: string;
}

@Injectable()
export class BalanceService {
  constructor(
    @InjectRepository(Balance)
    private balanceRepository: Repository<Balance>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(PointTransaction)
    private pointTransactionRepository: Repository<PointTransaction>,
    private dataSource: DataSource,
    @InjectMapper()
    private mapper: Mapper,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
    private transactionService: TransactionManagerService,
  ) { }

  async maxBalance(payload: any) {
    JSON.stringify(payload);
    const result = await this.balanceRepository
      .createQueryBuilder('b')
      .select('MAX(b.points)', 'max')
      .addSelect('MIN(b.points)', 'min')
      .getRawOne();

    const res = new MaxBalanceResponseDto();
    res.maxPoints = Number(result.max);
    res.minPoints = Number(result.min);
    return res;
  }

  async findOneByField(payload: FindByFieldDto) {
    const context = `${BalanceService.name}.${this.findOneByField.name}`;
    this.logger.debug(
      `Finding balance by field: ${JSON.stringify(payload)}`,
      context,
    );

    const where: FindOptionsWhere<Balance> = {};
    if (payload.slug) where.slug = payload.slug;
    if (payload.userSlug) where.user = { slug: payload.userSlug };

    const balance = await this.balanceRepository.findOne({ where: where });
    if (!balance)
      throw new BalanceException(BalanceValidation.BALANCE_NOT_FOUND);

    return this.mapper.map(balance, Balance, BalanceResponseDto);
  }

  async create(payload: { userSlug: string }) {
    const context = `${BalanceService.name}.${this.create.name}`;
    this.logger.log(
      `Creating balance req: ${JSON.stringify(payload)}`,
      context,
    );

    const user = await this.userRepository.findOne({
      where: { slug: payload.userSlug },
    });
    if (!user) throw new AuthException(AuthValidation.USER_NOT_FOUND);

    const balance = new Balance();

    Object.assign(balance, {
      user: user,
    } as Partial<Balance>);
    return await this.transactionService.execute<Balance>(
      async (manager) => {
        return await manager.save(balance);
      },
      () => this.logger.log(`Balance ${balance.slug} created`, context),
      (error) =>
        this.logger.log(
          `Error when creating balance: ${error.message}`,
          error.stack,
          context,
        ),
    );
  }

  // async calcBalance(payload: {
  //   userSlug: string;
  //   points: number;
  //   type: 'in' | 'out';
  // }) {
  //   const context = `${BalanceService.name}.${this.calcBalance.name}`;
  //   this.logger.log(`Calc balance req: ${JSON.stringify(payload)}`, context);

  //   let balance = await this.balanceRepository.findOne({
  //     where: {
  //       user: {
  //         slug: payload.userSlug,
  //       },
  //     },
  //   });
  //   if (!balance) {
  //     balance = await this.create({ userSlug: payload.userSlug });
  //   }

  //   const points = Math.abs(payload.points);
  //   balance.points = Number(balance.points);

  //   switch (payload.type) {
  //     case 'in':
  //       balance.points += points;
  //       break;
  //     case 'out':
  //       // Throw exceptions
  //       balance.points -= points;
  //       break;
  //     default:
  //       break;
  //   }
  //   await this.transactionService.execute<Balance>(
  //     async (manager) => {
  //       return await manager.save(balance);
  //     },
  //     (result) => {
  //       this.logger.log(`${JSON.stringify(result)}`, context);
  //     },
  //     (error) => {
  //       this.logger.error(
  //         `Error when calc balance: ${error.message}`,
  //         error.stack,
  //         context,
  //       );
  //     },
  //   );
  // }

  async validate(payload: { userSlug: string; points: number }) {
    const context = `${BalanceService.name}.${this.validate.name}`;
    this.logger.log(
      `Validate balance req: ${JSON.stringify(payload)}`,
      context,
    );

    let balance = await this.balanceRepository.findOne({
      where: {
        user: {
          slug: payload.userSlug,
        },
      },
    });
    if (!balance) {
      balance = await this.create({ userSlug: payload.userSlug });
    }

    const newPointsValue = balance.points - payload.points;

    if (newPointsValue < 0) {
      throw new BalanceException(BalanceValidation.INSUFFICIENT_BALANCE);
    }

    return true;
  }

  /*
   * Internal wallet routes (/internal/balance/*, step 6.5). The internal layer
   * resolves the User once by shared-user id; these methods take the entity.
   */

  async findUserById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  // Balance of each existing user among userIds, in the order asked, 0 when
  // the user has no balance row yet (no row is created on a read). Unknown
  // ids are left out.
  async lookupPointsByUserIds(
    userIds: string[],
  ): Promise<BalanceLookupResponse[]> {
    const ids = [...new Set(userIds)];
    const users = await this.userRepository.find({
      where: { id: In(ids) },
      select: { id: true },
    });
    const known = new Set(users.map((u) => u.id));
    const rows: { userId: string; points: string }[] =
      await this.balanceRepository
        .createQueryBuilder('b')
        .select('b.user_column', 'userId')
        .addSelect('b.points_column', 'points')
        .where('b.user_column IN (:...ids)', { ids })
        .getRawMany();
    const points = new Map(rows.map((r) => [r.userId, Number(r.points)]));
    return ids
      .filter((id) => known.has(id))
      .map((id) => ({ userId: id, points: points.get(id) ?? 0 }));
  }

  // Add xu, idempotent on input.transactionId.
  //
  // One transaction: lock the balance row of the user (SELECT ... FOR UPDATE),
  // add with an UPDATE on the column (no read-modify-save of the entity), read
  // the balance after, write the ledger row carrying the key. Two requests
  // with the same key run one after the other on the row lock; the second one
  // fails on the unique key of the ledger, rolls back and is answered as a
  // replay. The balance row keeps the key of the last transaction written to
  // it (step 6.3).
  async creditByKey(
    user: User,
    input: WalletCreditInput,
  ): Promise<BalanceCreditResponse> {
    const context = `${BalanceService.name}.${this.creditByKey.name}`;

    const recorded = await this.findLedgerRowByKey(input.transactionId);
    if (recorded) return this.replayOfCredit(recorded, user, input);

    await this.ensureBalanceRow(user);

    try {
      const row = await this.dataSource.transaction(async (manager) => {
        const [locked] = await manager.query(
          'SELECT id_column AS id FROM balance_tbl WHERE user_column = ? AND deleted_at_column IS NULL FOR UPDATE',
          [user.id],
        );
        if (!locked) {
          throw new BalanceException(BalanceValidation.BALANCE_NOT_FOUND);
        }
        await manager.query(
          'UPDATE balance_tbl SET points_column = points_column + ?, external_transaction_id_column = ? WHERE id_column = ?',
          [input.points, input.transactionId, locked.id],
        );
        const [after] = await manager.query(
          'SELECT points_column AS points FROM balance_tbl WHERE id_column = ?',
          [locked.id],
        );
        return manager.save(
          manager.create(PointTransaction, {
            type: PointTransactionTypeEnum.IN,
            desc: input.desc ?? null,
            objectType: input.objectType,
            objectId: input.objectId,
            objectSlug: input.objectSlug,
            points: input.points,
            user,
            userId: user.id,
            userSlug: user.slug,
            balance: Number(after.points),
            externalTransactionId: input.transactionId,
          }),
        );
      });
      this.logger.log(
        `Credited ${input.points} xu to user ${user.id}, key ${input.transactionId}, balance ${row.balance}`,
        context,
      );
      return this.toCreditResponse(row, false);
    } catch (error) {
      if (
        isDuplicateKey(error, LEDGER_KEY_INDEX) ||
        isDuplicateKey(error, BALANCE_KEY_INDEX)
      ) {
        const winner = await this.findLedgerRowByKey(input.transactionId);
        if (winner) return this.replayOfCredit(winner, user, input);
      }
      this.logger.error(
        `Error crediting key ${input.transactionId}: ${error.message}`,
        error.stack,
        context,
      );
      throw error;
    }
  }

  private findLedgerRowByKey(key: string): Promise<PointTransaction | null> {
    return this.pointTransactionRepository.findOne({
      where: { externalTransactionId: key },
    });
  }

  // Same key again: answer with the transaction already written, unless the
  // key was used for something else (another user, another amount, a debit),
  // which is a bug of the caller and must not pass as a replay.
  private replayOfCredit(
    row: PointTransaction,
    user: User,
    input: WalletCreditInput,
  ): BalanceCreditResponse {
    if (
      row.userId !== user.id ||
      row.type !== PointTransactionTypeEnum.IN ||
      Number(row.points) !== input.points
    ) {
      throw new ConflictException(
        `transactionId ${input.transactionId} is already recorded for a different transaction`,
      );
    }
    return this.toCreditResponse(row, true);
  }

  private toCreditResponse(
    row: PointTransaction,
    replayed: boolean,
  ): BalanceCreditResponse {
    return {
      transactionId: row.externalTransactionId,
      userId: row.userId,
      points: Number(row.points),
      balance: Number(row.balance),
      replayed,
      createdAt: row.createdAt,
    };
  }

  // Many users have no balance row yet (426 of 940 in the test database). Two
  // first credits of one user may both try to create it: user_column is
  // unique, the loser's duplicate is ignored and both go on to lock the same
  // row.
  private async ensureBalanceRow(user: User): Promise<void> {
    const count = await this.balanceRepository.count({
      where: { user: { id: user.id } },
    });
    if (count > 0) return;
    try {
      await this.balanceRepository.save(
        this.balanceRepository.create({ user }),
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
}
