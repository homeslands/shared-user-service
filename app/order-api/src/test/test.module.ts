import { Module } from '@nestjs/common';
import { TestController } from './test.controller';
import { TestInternalController } from './internal/test-internal.controller';
import { TestRmqController } from './rmq/test-rmq.controller';
import { SharedClientsModule } from 'src/shared/clients/shared-clients.module';
import { TrendServiceModule } from 'src/external-services/trend-service/trend-service.module';
import { TerminalServiceModule } from 'src/external-services/terminal-service/terminal-service.module';

@Module({
  imports: [SharedClientsModule, TrendServiceModule, TerminalServiceModule],
  controllers: [TestController, TestInternalController, TestRmqController],
})
export class TestModule {}
