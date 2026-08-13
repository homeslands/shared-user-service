import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalApiGuard } from 'src/common/guards/internal-api.guard';

interface PingRequest {
  from: string;
  message: string;
}

// Expose POST /internal/test/ping - nhan goi HTTP noi bo tu trend.
@UseGuards(InternalApiGuard)
@Controller('internal/test')
export class TestInternalController {
  @Post('ping')
  ping(@Body() body: PingRequest) {
    return {
      from: 'shared_user',
      message: `pong from shared-user (received: ${body.message})`,
      receivedAt: new Date().toISOString(),
    };
  }
}
