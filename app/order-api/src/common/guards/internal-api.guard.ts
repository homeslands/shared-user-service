import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { signInternalRequest } from 'src/common/utils/internal-signature.util';

const TIMESTAMP_TOLERANCE_MS = 30_000;

// Guard cho toan bo route /internal/* - xac thuc bang HMAC ky theo request
// (X-Signature + X-Timestamp), theo architect-http.md muc 5.1.
@Injectable()
export class InternalApiGuard implements CanActivate {
  // Tien to [INTERNAL] de loc rieng log cua request goi tu service khac
  // (trend) sang, tach khoi log cua request client-facing binh thuong.
  private readonly logger = new Logger('INTERNAL');

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer }>();
    const requestLabel = `method=${request.method} path=${request.originalUrl} from=${request.ip}`;

    const signature = request.header('x-signature');
    const timestamp = request.header('x-timestamp');
    if (!signature || !timestamp) {
      this.logger.warn(`${requestLabel} - rejected: missing signature headers`);
      throw new ForbiddenException('Missing internal signature headers');
    }

    const timestampMs = Number(timestamp);
    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(Date.now() - timestampMs) > TIMESTAMP_TOLERANCE_MS
    ) {
      this.logger.warn(`${requestLabel} - rejected: timestamp expired`);
      throw new ForbiddenException('Internal request timestamp expired');
    }

    const secret = this.configService.get<string>('INTERNAL_API_SECRET');
    const rawBody = request.rawBody ?? Buffer.from('');
    const expectedSignature = signInternalRequest(
      secret,
      request.method,
      request.originalUrl,
      rawBody.toString(),
      timestamp,
    );

    const provided = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      this.logger.warn(`${requestLabel} - rejected: invalid signature`);
      throw new ForbiddenException('Invalid internal signature');
    }

    this.logger.log(`${requestLabel} - verified`);
    return true;
  }
}
