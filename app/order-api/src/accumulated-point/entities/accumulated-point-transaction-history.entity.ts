import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Base } from 'src/app/base.entity';
import { AutoMap } from '@automapper/classes';
import { AccumulatedPoint } from './accumulated-point.entity';

@Entity('accumulated_point_transaction_history_tbl')
export class AccumulatedPointTransactionHistory extends Base {
  @AutoMap()
  @Column({
    name: 'type_column',
  })
  type: string;

  @AutoMap()
  @Column({ name: 'points_column' })
  points: number;

  // The points after the transaction
  @AutoMap()
  @Column({ name: 'last_points_column' })
  lastPoints: number;

  @AutoMap()
  @Column({ name: 'current_points_percentage_column' })
  currentPointsPercentage: number;

  @AutoMap()
  @Column({ type: 'timestamp', precision: 6, name: 'date_column' })
  date: Date;

  @AutoMap()
  @Column({
    name: 'status_column',
  })
  status: string;

  // Soft reference to the object that produced this row (step 6.2), same
  // pattern as point_transaction_tbl. The order belongs to the calling service
  // (trend, terminal), so there is no foreign key across that boundary:
  // objectType 'ORDER', objectId = order id in that service, objectSlug =
  // '<service>:<orderSlug>'. The old foreign key column is kept as
  // _deprecated_order_column until stage 10 and is not mapped.
  @AutoMap()
  @Column({ name: 'object_id_column', nullable: true })
  objectId?: string;

  @AutoMap()
  @Column({ name: 'object_type_column', nullable: true })
  objectType?: string;

  @AutoMap()
  @Column({ name: 'object_slug_column', nullable: true })
  objectSlug?: string;

  // Many to one with accumulated point
  @AutoMap(() => AccumulatedPoint)
  @ManyToOne(
    () => AccumulatedPoint,
    (accumulatedPoint) => accumulatedPoint.transactions,
  )
  @JoinColumn({ name: 'accumulated_point_column' })
  accumulatedPoint: AccumulatedPoint;

  // Idempotency key sent by the calling service ('<service>:<reference>...'),
  // unique over the whole string, prefix included, compared byte for byte
  // (step 6.3, migration v4.0.0-04). Ledger row: the key of this
  // transaction; the unique index refuses a replay.
  @Index('UQ_ap_history_external_transaction_id', { unique: true })
  @Column({
    name: 'external_transaction_id_column',
    type: 'varchar',
    length: 191,
    nullable: true,
    collation: 'utf8mb4_bin',
  })
  externalTransactionId?: string;

  // Expiry of a reservation row (step 6.4, QD11, migration v4.0.0-05): sent by
  // the calling service on reserve; the step 6.8 job releases reserve/pending
  // rows past it. NULL = no expiry (old rows, rows of the existing reserve
  // path).
  @AutoMap()
  @Column({
    type: 'timestamp',
    precision: 6,
    name: 'expires_at_column',
    nullable: true,
  })
  expiresAt?: Date;

  // Not mapped: active_reservation_key_column, a STORED generated column that
  // is '<accumulated_point_column>:<service>' on an active reservation
  // (reserve/pending, not soft deleted) and NULL otherwise, under the unique
  // index ACTIVE_RESERVATION_INDEX: at most one active reservation per
  // (person, service) (step 6.4, QD-T3). The database computes it on every
  // write.
}
