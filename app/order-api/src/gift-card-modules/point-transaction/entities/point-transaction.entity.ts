import { AutoMap } from '@automapper/classes';
import { Base } from 'src/app/base.entity';
import { User } from 'src/user/user.entity';
import { Column, Entity, JoinColumn, ManyToOne, Index } from 'typeorm';

@Entity('point_transaction_tbl')
export class PointTransaction extends Base {
  @Column({ name: 'type_column' }) // IN, OUT
  @AutoMap()
  type: string;

  @Column({ name: 'desc_column', nullable: true })
  @AutoMap()
  desc: string;

  @Column({ name: 'object_id_column' })
  @AutoMap()
  objectId: string; // ORDER, GIFT_CARD

  @Column({ name: 'object_type_column' })
  @AutoMap()
  objectType: string;

  @Column({ name: 'object_slug_column' })
  @AutoMap()
  objectSlug: string;

  @Column({ name: 'points_column' })
  @AutoMap()
  points: number;

  @AutoMap(() => User)
  @ManyToOne(() => User, (user) => user.pointTransactions, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'user_column' })
  user: User;

  @Column({ name: 'user_id_column' })
  @AutoMap()
  userId: string;

  @Column({ name: 'user_slug_column' })
  @AutoMap()
  userSlug: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'balance_column',
    default: 0,
  })
  @AutoMap()
  balance: number;

  // Idempotency key sent by the calling service ('<service>:<reference>...'),
  // unique over the whole string, prefix included, compared byte for byte
  // (step 6.3, migration v4.0.0-04). Ledger row: the key of this
  // transaction; the unique index refuses a replay.
  @Index('UQ_point_transaction_external_transaction_id', { unique: true })
  @Column({
    name: 'external_transaction_id_column',
    type: 'varchar',
    length: 191,
    nullable: true,
    collation: 'utf8mb4_bin',
  })
  externalTransactionId?: string;
}
