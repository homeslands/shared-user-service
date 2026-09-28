import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminalServiceClient } from './terminal-service.client';

@Module({
  imports: [HttpModule],
  providers: [TerminalServiceClient],
  exports: [TerminalServiceClient],
})
export class TerminalServiceModule {}
