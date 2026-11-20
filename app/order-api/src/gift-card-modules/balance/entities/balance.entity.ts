import { AutoMap } from '@automapper/classes';
import { Base } from 'src/app/base.entity';
import { User } from 'src/user/user.entity';
import { Column, Entity, JoinColumn, OneToOne, Index } from 'typeorm';

@Entity('balance_tbl')
export class Balance extends Base {
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'points_column',
    default: 0,
  })
  @AutoMap()
  points: number;

  @OneToOne(() => User)
  @JoinColumn({ name: 'user_column' })
  @AutoMap(() => User)
  user: User;

  // Idempotency key sent by the calling service ('<service>:<reference>...'),
  // unique over the whole string, prefix included, compared byte for byte
  // (step 6.3, migration v4.0.0-04). Balance row (one per user): the key of the last
  // transaction written to it.
  @Index('UQ_balance_external_transaction_id', { unique: true })
  @Column({
    name: 'external_transaction_id_column',
    type: 'varchar',
    length: 191,
    nullable: true,
    collation: 'utf8mb4_bin',
  })
  externalTransactionId?: string;
}
