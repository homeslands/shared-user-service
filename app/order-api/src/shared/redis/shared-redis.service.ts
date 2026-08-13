import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QueueRegisterKey } from 'src/app/app.constants';

const KEY_PREFIX = 'shared_user';

@Injectable()
export class SharedRedisService implements OnModuleInit {
  private client: Redis;

  constructor(
    @InjectQueue(QueueRegisterKey.SHARED_REDIS)
    private readonly jobQueue: Queue,
  ) {}

  async onModuleInit() {
    this.client = (await this.jobQueue.client) as Redis;
  }

  private withPrefix(key: string): string {
    return `${KEY_PREFIX}:${key}`;
  }

  /** SET key value EX seconds */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(this.withPrefix(key), value, 'EX', ttlSeconds);
  }

  /** GET key — returns value or null if key doesn't exist/expired */
  async get(key: string): Promise<string | null> {
    return this.client.get(this.withPrefix(key));
  }

  /** DEL key — returns number of keys deleted (1 = existed and deleted, 0 = didn't exist) */
  async del(key: string): Promise<number> {
    return this.client.del(this.withPrefix(key));
  }
}
