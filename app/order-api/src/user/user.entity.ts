import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  OneToOne,
  Index,
} from 'typeorm';
import { Base } from 'src/app/base.entity';
import { AutoMap } from '@automapper/classes';
import { ForgotPasswordToken } from 'src/auth/entity/forgot-password-token.entity';
import { Role } from 'src/role/role.entity';
import { VerifyEmailToken } from 'src/auth/entity/verify-email-token.entity';
import { VerifyPhoneNumberToken } from 'src/auth/entity/verify-phone-number-token.entity';
import { PointTransaction } from 'src/gift-card-modules/point-transaction/entities/point-transaction.entity';
import { AccumulatedPoint } from 'src/accumulated-point/entities/accumulated-point.entity';
import { UserLanguage } from './user.constant';
import { Balance } from 'src/gift-card-modules/balance/entities/balance.entity';
import { MembershipCard } from 'src/membership-card/membership-card.entity';
import { UserRequirement } from './user-requirement.entity';

// QD19 + QD21: index cho list-recent loc theo created_at_column (migration
// v4.0.0-02). Khai bao o cap class vi cot nam o Base - dat @Index trong Base
// se danh index moi bang ke thua no. Ten phai khop migration, khong thi
// migration:generate sinh DROP + CREATE.
@Index('IDX_user_tbl_created_at_column', ['createdAt'])
@Entity('user_tbl')
export class User extends Base {
  @AutoMap()
  @Column({ name: 'phonenumber_column', unique: true })
  phonenumber: string;

  @Column({ name: 'password_column' })
  password: string;

  @Column({ name: 'first_name_column', nullable: true })
  @AutoMap()
  firstName: string;

  @Column({ name: 'last_name_column', nullable: true })
  @AutoMap()
  lastName: string;

  @AutoMap()
  @Column({ name: 'language_column', default: UserLanguage.VI })
  language: string;

  @Column({ name: 'is_active_column', default: true })
  @AutoMap()
  isActive: boolean;

  // QD18 - danh tinh DUNG CHUNG vs RIENG cua mot service:
  //   null      = tai khoan dung chung (khach). Moi service tieu thu duoc tu
  //               cap hang cuc bo voi role mac dinh cua chinh no.
  //   'trend'   = rieng cua trend (nhan vien, hang he thong). Service khac
  //               KHONG duoc tu cap hang cuc bo.
  //   Sentinel khach vang lai de null (khach dung chung toan cum), nhan dien
  //   bang DEFAULT_CUSTOMER_SHARED_ID, khong bang cot nay.
  //
  // COT MO TA, KHONG PHAI CUA CHAN: shared-user tra gia tri nay ra trong
  // lookup/batch-lookup/list-recent, BEN GOI tu quyet dinh. shared-user
  // khong tu choi tra du lieu dua tren cot nay - lam the la no quay lai lam
  // authorization (mau thuan QD15).
  //
  // COT BAT BIEN: da co gia tri thi khong doi, khong co duong thang
  // 'trend' -> null. Nguoi vua la nhan vien vua la khach phai co hai tai
  // khoan, hai SDT. Xem architect-http.md muc 1.1 quy tac 6.
  @Index('IDX_user_tbl_owner_service_column')
  @Column({
    name: 'owner_service_column',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  @AutoMap()
  ownerService?: string | null;

  @Column({ name: 'dob_column', nullable: true })
  @AutoMap()
  dob?: string;

  @Column({ name: 'dob_day_month', nullable: true })
  @AutoMap()
  dobDM?: string;

  @AutoMap()
  @Column({ name: 'email_column', nullable: true, unique: true })
  email?: string;

  @AutoMap()
  @Column({ name: 'address_column', nullable: true })
  address?: string;

  @AutoMap()
  @Column({ name: 'image_column', nullable: true })
  image?: string;

  // Step 6.13: shared-user keeps identity and drops the business relations of
  // the monolith copy (branch, orders, card orders, gift cards, user groups,
  // device tokens, vouchers, campaign recipients): they belong to the order
  // services, which hold a sharedUserId instead. The opposite of trend, which
  // keeps the business relations and drops identity; both meet at the
  // sharedUserId. Kept: identity, the wallet (coin transactions, balance,
  // points), the three token relations, role (QD15: shared-user's own roles),
  // membershipCard and userRequirements (QD22: both tables now belong to
  // shared-user, login and refresh read userRequirements).
  // No migration here: branch_id_column stays in user_tbl as it is.

  @OneToMany(() => ForgotPasswordToken, (token) => token.user)
  forgotPasswordTokens: ForgotPasswordToken[];

  // One to one with role
  @ManyToOne(() => Role, (role) => role.users)
  @JoinColumn({ name: 'role_column' })
  @AutoMap(() => Role)
  role: Role;

  @Column({ name: 'is_verified_email_column', default: false })
  @AutoMap()
  isVerifiedEmail: boolean;

  @OneToMany(() => VerifyEmailToken, (token) => token.user)
  verifyEmailTokens: VerifyEmailToken[];

  @Column({ name: 'is_verified_phonenumber_column', default: false })
  @AutoMap()
  isVerifiedPhonenumber: boolean;

  @OneToMany(
    () => VerifyPhoneNumberToken,
    (verifyPhoneNumberToken) => verifyPhoneNumberToken.user,
  )
  verifyPhoneNumberTokens: VerifyPhoneNumberToken[];

  @OneToMany(() => PointTransaction, (pt) => pt.user)
  pointTransactions: PointTransaction[];

  @OneToOne(() => AccumulatedPoint, (accumulatedPoint) => accumulatedPoint.user)
  @JoinColumn({ name: 'accumulated_point_column' })
  @AutoMap(() => AccumulatedPoint)
  accumulatedPoint: AccumulatedPoint;

  @OneToOne(() => Balance, (b) => b.user)
  balance: Balance;

  @OneToOne(() => MembershipCard, (m) => m.user, {
    cascade: ['insert', 'update', 'remove'],
  })
  membershipCard: MembershipCard;

  @OneToMany(() => UserRequirement, (ur) => ur.user, {
    cascade: ['insert', 'update', 'remove'],
  })
  @AutoMap(() => UserRequirement)
  userRequirements: UserRequirement[];
}
