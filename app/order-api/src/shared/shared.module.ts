import { Module } from '@nestjs/common';
import { User } from 'src/user/user.entity';
import { DbModule } from 'src/db/db.module';
import { Balance } from 'src/gift-card-modules/balance/entities/balance.entity';
import { SharedBalanceService } from './services/shared-balance.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedRedisModule } from './redis/shared-redis.module';

@Module({
  imports: [
    SharedRedisModule,
    DbModule,
    TypeOrmModule.forFeature([User, Balance]),
  ],
  providers: [SharedBalanceService],
  exports: [SharedBalanceService],
})
export class SharedModule {}
