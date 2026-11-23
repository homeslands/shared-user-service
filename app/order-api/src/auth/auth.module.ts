import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from 'src/user/user.module';
import { PassportModule } from '@nestjs/passport';
import { LocalStrategy } from './passport/local/local.strategy';
import { JwtModule } from '@nestjs/jwt';
import { jwtConstants } from './constants';
import { JwtStrategy } from './passport/jwt/jwt.strategy';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/user/user.entity';
import { ConfigModule } from '@nestjs/config';
import { AuthProfile } from './auth.mapper';
import { FileModule } from 'src/file/file.module';
import { MailModule } from 'src/mail/mail.module';
import { ForgotPasswordToken } from './entity/forgot-password-token.entity';
import { Role } from 'src/role/role.entity';
import { SystemConfigModule } from 'src/system-config/system-config.module';
import { VerifyEmailToken } from './entity/verify-email-token.entity';
import { DbModule } from 'src/db/db.module';
import { AuthUtils } from './auth.utils';
import { ZaloOaConnectorConfig } from 'src/zalo-oa-connector/entity/zalo-oa-connector.entity';
import { VerifyPhoneNumberToken } from './entity/verify-phone-number-token.entity';
import { RegisterOtpToken } from './entity/register-otp-token.entity';
import { ZaloOaConnectorModule } from 'src/zalo-oa-connector/zalo-oa-connector.module';
import { SharedModule } from 'src/shared/shared.module';
import { DomainEventsModule } from 'src/domain-events/domain-events.module';

@Module({
  imports: [
    UserModule,
    PassportModule,
    JwtModule.register({
      privateKey: jwtConstants.privateKey,
      publicKey: jwtConstants.publicKey,
      signOptions: { algorithm: jwtConstants.algorithm },
      verifyOptions: { algorithms: [jwtConstants.algorithm] },
    }),
    TypeOrmModule.forFeature([
      User,
      ForgotPasswordToken,
      Role,
      VerifyEmailToken,
      ZaloOaConnectorConfig,
      VerifyPhoneNumberToken,
      RegisterOtpToken,
    ]),
    ConfigModule,
    FileModule,
    MailModule,
    SystemConfigModule,
    DbModule,
    UserModule,
    ZaloOaConnectorModule,
    SharedModule,
    DomainEventsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy, AuthProfile, AuthUtils],
})
export class AuthModule {}
