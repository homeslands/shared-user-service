import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Public } from 'src/auth/decorator/public.decorator';
import { TrendServiceClient } from 'src/external-services/trend-service/trend-service.client';

// Route REST cho client - kich hoat goi qua trend (HTTP noi bo hoac publish
// RMQ). Phan nhan message RMQ tu trend nam o rmq/test-rmq.controller.ts,
// khong gop chung o day.

@Controller('test')
export class TestController {
  constructor(
    @Inject('TREND_RMQ') private readonly rmqClient: ClientProxy,
    private readonly trendServiceClient: TrendServiceClient,
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
    return this.rmqClient.send('ping', {
      from: 'shared_user',
      at: new Date().toISOString(),
    });
  }
}
