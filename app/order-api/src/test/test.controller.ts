import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Public } from 'src/auth/decorator/public.decorator';
import { TrendServiceClient } from 'src/external-services/trend-service/trend-service.client';
import { TerminalServiceClient } from 'src/external-services/terminal-service/terminal-service.client';

// Route REST cho client - kich hoat goi qua trend/terminal (HTTP noi bo hoac
// publish RMQ). Phan nhan message RMQ tu cac service do nam o
// rmq/test-rmq.controller.ts, khong gop chung o day.

@Controller('test')
export class TestController {
  constructor(
    @Inject('TREND_RMQ') private readonly trendRmqClient: ClientProxy,
    @Inject('TERMINAL_RMQ') private readonly terminalRmqClient: ClientProxy,
    private readonly trendServiceClient: TrendServiceClient,
    private readonly terminalServiceClient: TerminalServiceClient,
  ) {}

  // shared-user goi HTTP noi bo sang trend (POST /internal/test/ping)
  @Public()
  @Get('http/trend')
  callTrendHttp() {
    return this.trendServiceClient.ping('hello from shared-user');
  }

  // shared-user goi RMQ sang trend (pattern 'ping', gui vao trend_queue)
  @Public()
  @Get('rmq/trend')
  callTrendRmq() {
    return this.trendRmqClient.send('ping', {
      from: 'shared_user',
      at: new Date().toISOString(),
    });
  }

  // shared-user goi HTTP noi bo sang terminal (POST /internal/test/ping)
  @Public()
  @Get('http/terminal')
  callTerminalHttp() {
    return this.terminalServiceClient.ping('hello from shared-user');
  }

  // shared-user goi RMQ sang terminal (pattern 'ping', gui vao terminal_queue)
  @Public()
  @Get('rmq/terminal')
  callTerminalRmq() {
    return this.terminalRmqClient.send('ping', {
      from: 'shared_user',
      at: new Date().toISOString(),
    });
  }
}
