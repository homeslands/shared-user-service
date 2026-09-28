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
import { INTERNAL_SERVICE_HEADER } from 'src/common/constants/internal-api.constant';

const TIMESTAMP_TOLERANCE_MS = 30_000;

// Request da qua InternalApiGuard mang them ten service goi, doc tu header
// `x-internal-service`. Dung cho QD18: `POST /internal/users` voi
// `isShared: false` phai ghi owner_service = ten service goi, va ten do lay
// tu danh tinh CLIENT chu khong phai tu body - de mot service khong khai
// duoc hang thuoc ve service khac.
export interface InternalRequest extends Request {
  internalService?: string;
}

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
      .getRequest<InternalRequest & { rawBody?: Buffer }>();
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

    // Chu ky da dung => day la mot service noi bo that. Ghi lai ten no de
    // handler dung (QD18). Ten nay KHONG duoc chu ky bao ve (xem
    // INTERNAL_SERVICE_HEADER) nen chi dung de PHAN LOAI, khong dung de
    // phan quyen.
    request.internalService = request.header(INTERNAL_SERVICE_HEADER) || null;

    this.logger.log(
      `${requestLabel} service=${request.internalService ?? '(unknown)'} - verified`,
    );
    return true;
  }
}
