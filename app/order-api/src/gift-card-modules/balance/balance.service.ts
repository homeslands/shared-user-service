import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Balance } from './entities/balance.entity';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { BalanceLookup } from './balance-lookup.interface';
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
  BalanceLookupResponse,
  BalanceMoveResponse,
  BalanceTransactionResponse,
  WALLET_RELEASE_SUFFIX,
} from './internal/balance-internal.dto';

// Unique index on the idempotency key of the xu ledger and of the balance row
// (step 6.3, migration v4.0.0-04).
const LEDGER_KEY_INDEX = 'UQ_point_transaction_external_transaction_id';
const BALANCE_KEY_INDEX = 'UQ_balance_external_transaction_id';

const isDuplicateKey = (error: any, index?: string): boolean =>
  (error?.code ?? error?.driverError?.code) === 'ER_DUP_ENTRY' &&
  (!index || String(error?.message).includes(index));

// A credit or debit of /internal/balance/* (steps 6.5, 6.6): the key of the
// calling service and the soft reference of its object, stored on the ledger
// row.
export interface WalletMoveInput {
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
  ) {}

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

  // Step 6.9 (QD17): GET /balance, the self view. The user is the one of the
  // token, never a slug sent by the client. Same answer as findOneByField.
  async findOneByUserId(userId: string) {
    const balance = await this.balanceRepository.findOne({
      where: { user: { id: userId } },
    });
    if (!balance)
      throw new BalanceException(BalanceValidation.BALANCE_NOT_FOUND);

    return this.mapper.map(balance, Balance, BalanceResponseDto);
  }

  async findOneByField(payload: BalanceLookup) {
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
  // ids are left out. Step 7.7d: also the slug and createdAt of the balance
  // row (null without a row), read in the same query.
  async lookupPointsByUserIds(
    userIds: string[],
  ): Promise<BalanceLookupResponse[]> {
    const ids = [...new Set(userIds)];
    const users = await this.userRepository.find({
      where: { id: In(ids) },
      select: { id: true },
    });
    const known = new Set(users.map((u) => u.id));
    const rows: {
      userId: string;
      points: string;
      slug: string;
      createdAt: Date;
    }[] = await this.balanceRepository
      .createQueryBuilder('b')
      .select('b.user_column', 'userId')
      .addSelect('b.points_column', 'points')
      .addSelect('b.slug_column', 'slug')
      .addSelect('b.created_at_column', 'createdAt')
      .where('b.user_column IN (:...ids)', { ids })
      .getRawMany();
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    return ids
      .filter((id) => known.has(id))
      .map((id) => {
        const row = byUser.get(id);
        return {
          userId: id,
          points: row ? Number(row.points) : 0,
          slug: row?.slug ?? null,
          createdAt: row?.createdAt ?? null,
        };
      });
  }

  // Add xu, idempotent on input.transactionId (step 6.5).
  async creditByKey(
    user: User,
    input: WalletMoveInput,
  ): Promise<BalanceMoveResponse> {
    return this.moveByKey(user, input, PointTransactionTypeEnum.IN);
  }

  // Take xu in one step, idempotent on input.transactionId (step 6.6, QD9).
  // Refused with INSUFFICIENT_BALANCE when the balance is short: the balance
  // never goes below zero, checked on the locked row and again in the WHERE
  // of the UPDATE.
  async debitByKey(
    user: User,
    input: WalletMoveInput,
  ): Promise<BalanceMoveResponse> {
    return this.moveByKey(user, input, PointTransactionTypeEnum.OUT);
  }

  // Give back a debit after the caller failed to finish what it was for
  // (trend-api.md 7.4 Z-7), called with the key of the debit. Writes the
  // credit K:release with the same points and soft reference, idempotent like
  // any other move: releasing twice gives back once.
  async releaseByKey(debitKey: string): Promise<BalanceMoveResponse> {
    const debit = await this.findLedgerRowByKey(debitKey);
    if (!debit) {
      throw new NotFoundException(`Transaction ${debitKey} not found`);
    }
    if (debit.type !== PointTransactionTypeEnum.OUT) {
      throw new ConflictException(`Transaction ${debitKey} is not a debit`);
    }
    const user = await this.findUserById(debit.userId);
    if (!user) throw new NotFoundException('User not found');
    return this.moveByKey(
      user,
      {
        points: Number(debit.points),
        transactionId: `${debitKey}${WALLET_RELEASE_SUFFIX}`,
        objectType: debit.objectType,
        objectId: debit.objectId,
        objectSlug: debit.objectSlug,
        desc: `release of ${debitKey}`,
      },
      PointTransactionTypeEnum.IN,
    );
  }

  // lookup-transaction (QD10): the ledger row written under a key, or null.
  async findTransactionByKey(
    key: string,
  ): Promise<BalanceTransactionResponse | null> {
    const row = await this.findLedgerRowByKey(key);
    if (!row) return null;
    return {
      transactionId: row.externalTransactionId,
      userId: row.userId,
      type: row.type,
      points: Number(row.points),
      balance: Number(row.balance),
      objectType: row.objectType,
      objectId: row.objectId,
      objectSlug: row.objectSlug,
      createdAt: row.createdAt,
    };
  }

  // One transaction: lock the balance row of the user (SELECT ... FOR UPDATE),
  // look the key up under the lock, move the points with an UPDATE on the
  // column (no read-modify-save of the entity; WHERE refuses a negative
  // result), read the balance after, write the ledger row carrying the key.
  // Every move of one user runs one after the other on the row lock, so a
  // second request with the same key finds the first one's row and is
  // answered as a replay; the unique key of the ledger is the last fence. The
  // balance row keeps the key of the last transaction written to it (6.3).
  private async moveByKey(
    user: User,
    input: WalletMoveInput,
    type: PointTransactionTypeEnum,
  ): Promise<BalanceMoveResponse> {
    const context = `${BalanceService.name}.${this.moveByKey.name}`;
    const key = input.transactionId;

    const recorded = await this.findLedgerRowByKey(key);
    if (recorded) return this.replayOfMove(recorded, user, input, type);

    if (type === PointTransactionTypeEnum.IN) await this.ensureBalanceRow(user);
    const delta =
      type === PointTransactionTypeEnum.IN ? input.points : -input.points;

    try {
      const row = await this.dataSource.transaction(async (manager) => {
        const [locked] = await manager.query(
          'SELECT id_column AS id, points_column AS points FROM balance_tbl WHERE user_column = ? AND deleted_at_column IS NULL FOR UPDATE',
          [user.id],
        );
        // No balance row: nothing to take (a credit created it above).
        if (!locked) {
          throw new BalanceException(
            type === PointTransactionTypeEnum.OUT
              ? BalanceValidation.INSUFFICIENT_BALANCE
              : BalanceValidation.BALANCE_NOT_FOUND,
          );
        }
        const [already] = await manager.query(
          'SELECT id_column AS id FROM point_transaction_tbl WHERE external_transaction_id_column = ?',
          [key],
        );
        if (already) return null;
        if (Number(locked.points) + delta < 0) {
          throw new BalanceException(BalanceValidation.INSUFFICIENT_BALANCE);
        }
        const updated = await manager.query(
          'UPDATE balance_tbl SET points_column = points_column + ?, external_transaction_id_column = ? WHERE id_column = ? AND points_column + ? >= 0',
          [delta, key, locked.id, delta],
        );
        if (updated?.affectedRows !== 1) {
          throw new BalanceException(BalanceValidation.INSUFFICIENT_BALANCE);
        }
        const [after] = await manager.query(
          'SELECT points_column AS points FROM balance_tbl WHERE id_column = ?',
          [locked.id],
        );
        return manager.save(
          manager.create(PointTransaction, {
            type,
            desc: input.desc ?? null,
            objectType: input.objectType,
            objectId: input.objectId,
            objectSlug: input.objectSlug,
            points: input.points,
            user,
            userId: user.id,
            userSlug: user.slug,
            balance: Number(after.points),
            externalTransactionId: key,
          }),
        );
      });
      if (!row) {
        return this.replayOfMove(
          await this.findLedgerRowByKey(key),
          user,
          input,
          type,
        );
      }
      this.logger.log(
        `Moved ${delta} xu for user ${user.id}, key ${key}, balance ${row.balance}`,
        context,
      );
      return this.toMoveResponse(row, false);
    } catch (error) {
      if (error instanceof BalanceException) throw error;
      if (
        isDuplicateKey(error, LEDGER_KEY_INDEX) ||
        isDuplicateKey(error, BALANCE_KEY_INDEX)
      ) {
        const winner = await this.findLedgerRowByKey(key);
        if (winner) return this.replayOfMove(winner, user, input, type);
      }
      this.logger.error(
        `Error moving xu with key ${key}: ${error.message}`,
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
  // key was used for something else (another user, another amount, the other
  // direction), which is a bug of the caller and must not pass as a replay.
  private replayOfMove(
    row: PointTransaction,
    user: User,
    input: WalletMoveInput,
    type: PointTransactionTypeEnum,
  ): BalanceMoveResponse {
    if (
      row.userId !== user.id ||
      row.type !== type ||
      Number(row.points) !== input.points
    ) {
      throw new ConflictException(
        `transactionId ${input.transactionId} is already recorded for a different transaction`,
      );
    }
    return this.toMoveResponse(row, true);
  }

  private toMoveResponse(
    row: PointTransaction,
    replayed: boolean,
  ): BalanceMoveResponse {
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
