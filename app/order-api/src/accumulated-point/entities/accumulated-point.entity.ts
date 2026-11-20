import { Entity, Column, OneToMany, OneToOne, Index } from 'typeorm';
import { Base } from 'src/app/base.entity';
import { AutoMap } from '@automapper/classes';
import { User } from 'src/user/user.entity';
import { AccumulatedPointTransactionHistory } from './accumulated-point-transaction-history.entity';

@Entity('accumulated_point_tbl')
export class AccumulatedPoint extends Base {
  @AutoMap()
  @Column({ name: 'total_points_column', default: 0 })
  totalPoints: number;

  // Many to one with user
  @OneToOne(() => User, (user) => user.accumulatedPoint)
  user: User;

  // One to many with transaction history
  @OneToMany(
    () => AccumulatedPointTransactionHistory,
    (transaction) => transaction.accumulatedPoint,
  )
  transactions: AccumulatedPointTransactionHistory[];

  // Idempotency key sent by the calling service ('<service>:<reference>...'),
  // unique over the whole string, prefix included, compared byte for byte
  // (step 6.3, migration v4.0.0-04). Points row (one per user): the key of the last
  // transaction written to it.
  @Index('UQ_accumulated_point_external_transaction_id', { unique: true })
  @Column({
    name: 'external_transaction_id_column',
    type: 'varchar',
    length: 191,
    nullable: true,
    collation: 'utf8mb4_bin',
  })
  externalTransactionId?: string;
}
