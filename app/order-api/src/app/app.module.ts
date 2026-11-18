import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';
import { validate } from './env.validation';
import { AuthModule } from 'src/auth/auth.module';
import { AppService } from './app.service';
import { AppController } from './app.controller';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './http-exception.filter';
import { FileModule } from 'src/file/file.module';
import { HealthModule } from 'src/health/health.module';
import { AutomapperModule } from '@automapper/nestjs';
import { classes } from '@automapper/classes';
import { AppSubscriber } from './app.subscriber';
import { UserModule } from 'src/user/user.module';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'src/logger/logger.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'path';
import { DbModule } from 'src/db/db.module';
// import { JwtAuthGuard } from 'src/auth/passport/jwt/jwt-auth.guard';
import { RoleModule } from 'src/role/role.module';
import { RolesGuard } from 'src/role/roles.guard';
import { SystemConfigModule } from 'src/system-config/system-config.module';
import { BullModule } from '@nestjs/bullmq';
import { ConnectionOptions } from 'bullmq';
import { LoggerMiddleware } from 'src/logger/logger.middleware';
import { RealIpMiddleware } from 'src/middleware/real-ip.middleware';
import { AuthorityModule } from 'src/authority/authority.module';
import { AuthorityGroupModule } from 'src/authority-group/authority-group.module';
import { PermissionModule } from 'src/permission/permission.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { GiftCardModule } from 'src/gift-card-modules/gift-card.module';
import { ZaloOaConnectorModule } from 'src/zalo-oa-connector/zalo-oa-connector.module';
import { SharedModule } from 'src/shared/shared.module';
import { AccumulatedPointModule } from 'src/accumulated-point/accumulated-point.module';
import { RoleBasedSerializationInterceptor } from 'src/role/role.interceptor';
import { JwtOptionalAuthGuard } from 'src/auth/passport/jwt/jwt-optional-auth.guard';
import { MembershipCardModule } from 'src/membership-card/membership-card.module';

import { TestModule } from 'src/test/test.module';
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const connectionOptions: ConnectionOptions = {
          host: config.get('REDIS_HOST'),
          port: config.get('REDIS_PORT'),
          password: config.get('REDIS_PASSWORD'),
          retryStrategy: (times) => {
            if (times > 10) return null;
            return 3000;
          },
        };
        return {
          connection: connectionOptions,
          prefix: 'shared_user',
        };
      },
      inject: [ConfigService],
    }),
    ServeStaticModule.forRoot({
      rootPath: resolve('public'),
    }),
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      validate: validate,
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    AutomapperModule.forRoot({
      strategyInitializer: classes(),
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 100000,
        },
      ],
    }),
    AuthModule,
    FileModule,
    HealthModule,
    LoggerModule,
    UserModule,
    DbModule,
    RoleModule,
    SystemConfigModule,
    AuthorityModule,
    AuthorityGroupModule,
    PermissionModule,
    GiftCardModule,
    ZaloOaConnectorModule,
    SharedModule,
    AccumulatedPointModule,
    MembershipCardModule,
    TestModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppSubscriber,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // {
    //   provide: APP_GUARD,
    //   useClass: JwtAuthGuard,
    // },
    {
      provide: APP_GUARD,
      useClass: JwtOptionalAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RoleBasedSerializationInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RealIpMiddleware, LoggerMiddleware).forRoutes('*');
  }
}
