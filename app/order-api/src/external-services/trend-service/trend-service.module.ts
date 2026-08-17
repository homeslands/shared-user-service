import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TrendServiceClient } from './trend-service.client';

@Module({
  imports: [HttpModule],
  providers: [TrendServiceClient],
  exports: [TrendServiceClient],
})
export class TrendServiceModule {}
