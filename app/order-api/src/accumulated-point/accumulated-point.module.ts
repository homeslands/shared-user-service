import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccumulatedPoint } from './entities/accumulated-point.entity';
import { AccumulatedPointTransactionHistory } from './entities/accumulated-point-transaction-history.entity';
import { AccumulatedPointService } from './accumulated-point.service';
import { AccumulatedPointController } from './accumulated-point.controller';
import { AccumulatedPointInternalController } from './internal/accumulated-point-internal.controller';
import { AccumulatedPointScheduler } from './accumulated-point.scheduler';
import { AccumulatedPointProfile } from './accumulated-point.mapper';
import { User } from 'src/user/user.entity';
import { Order } from 'src/order/order.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccumulatedPoint,
      AccumulatedPointTransactionHistory,
      User,
      Order,
    ]),
  ],
  controllers: [AccumulatedPointController, AccumulatedPointInternalController],
  providers: [
    AccumulatedPointService,
    AccumulatedPointProfile,
    AccumulatedPointScheduler,
  ],
  exports: [AccumulatedPointService],
})
export class AccumulatedPointModule {}
