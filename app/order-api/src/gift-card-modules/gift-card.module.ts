import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileModule } from 'src/file/file.module';
import { DbModule } from 'src/db/db.module';
import { BalanceController } from './balance/balance.controller';
import { BalanceInternalController } from './balance/internal/balance-internal.controller';
import { PointTransactionInternalController } from './point-transaction/internal/point-transaction-internal.controller';
import { BalanceService } from './balance/balance.service';
import { Balance } from './balance/entities/balance.entity';
import { BalanceProfile } from './balance/balance.mapper';
import { User } from 'src/user/user.entity';
import { HttpModule } from '@nestjs/axios';
import { PointTransactionController } from './point-transaction/point-transaction.controller';
import { PointTransactionService } from './point-transaction/point-transaction.service';
import { PointTransactionProfile } from './point-transaction/point-transaction.mapper';
import { PointTransaction } from './point-transaction/entities/point-transaction.entity';
import { SharedModule } from 'src/shared/shared.module';
import { BalanceScheduler } from './balance/balance.scheduler';

const controllers = [
  BalanceController,
  BalanceInternalController,
  PointTransactionInternalController,
  PointTransactionController,
];

const providers = [BalanceService, PointTransactionService];

const mappers = [BalanceProfile, PointTransactionProfile];

const modules = [
  TypeOrmModule.forFeature([Balance, User, PointTransaction]),
  FileModule,
  DbModule,
  HttpModule,
  SharedModule,
];

const exportServices = [BalanceService, PointTransactionService];

const exportMappers = [];

const schedulers = [BalanceScheduler];

@Module({
  imports: [...modules],
  controllers: [...controllers],
  providers: [...providers, ...mappers, ...schedulers],
  exports: [...exportServices, ...exportMappers],
})
export class GiftCardModule {}
