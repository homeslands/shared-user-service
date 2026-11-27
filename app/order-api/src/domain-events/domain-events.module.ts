import { Module } from '@nestjs/common';
import { SharedClientsModule } from 'src/shared/clients/shared-clients.module';
import { OrderCompletedConsumer } from './order-completed.consumer';
import { UserEventPublisher } from './user-event.publisher';

// Buoc 9.3 - domain event that qua RabbitMQ: phat `user.created` vao
// `trend_queue` + `terminal_queue`, nghe `order.completed` o `shared_user_queue`.
@Module({
  imports: [SharedClientsModule],
  controllers: [OrderCompletedConsumer],
  providers: [UserEventPublisher],
  exports: [UserEventPublisher],
})
export class DomainEventsModule {}
