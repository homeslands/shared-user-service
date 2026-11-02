import { Module } from '@nestjs/common';
import { MembershipCardService } from './membership-card.service';
import { MembershipCard } from './membership-card.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MembershipCardProfile } from './membership-card.mapper';
import { User } from 'src/user/user.entity';
import { TransactionManagerService } from 'src/db/transaction-manager.service';
import { MembershipCardScheduler } from './membership-card.scheduler';
import { Role } from 'src/role/role.entity';
import { UserGroup } from 'src/user-group/user-group.entity';
import { UserModule } from 'src/user/user.module';
import { MembershipCardInternalController } from './internal/membership-card-internal.controller';
import { MembershipCardInternalService } from './internal/membership-card-internal.service';

// QD22.e (buoc 2.4) - controller client-facing `/membership-card` (ban chep tu
// mono) GO DANG KY: khong UI nao goi no, de lai la mot cua ghi thang vao bang
// the that vuot quyen order service. Chi con controller noi bo. Scheduler het
// han the GIU - tu buoc 2.5 la ban duy nhat (trend/terminal go ban cua minh).
@Module({
  imports: [
    TypeOrmModule.forFeature([MembershipCard, User, Role, UserGroup]),
    UserModule,
  ],
  controllers: [MembershipCardInternalController],
  providers: [
    MembershipCardService,
    MembershipCardInternalService,
    MembershipCardProfile,
    MembershipCardScheduler,
    TransactionManagerService,
  ],
})
export class MembershipCardModule {}
