// Birthday jobs of shared-user (QD13, step 6.16).
//
// shared-user owns the date of birth, so it is the side that says "this user
// has a birthday tomorrow". What happens then (campaign rewards, the greeting
// and its channels) belongs to the consumer, which owns the campaigns (trend).
// The job only names the user: the consumer looks the identity up by
// sharedUserId (POST /internal/users/lookup) instead of reading a name or a
// phone number copied into Redis.
//
// The meeting point of the two services is the queue: QueueRegisterKey
// .USER_BIRTHDAY = 'user-birthday' under the BullMQ prefix of the consumer (see
// USER_BIRTHDAY_QUEUE_PREFIX_ENV).
export const USER_BIRTHDAY_TRIGGERED_JOB = 'user-birthday-triggered';

export interface UserBirthdayTriggeredJobData {
  // id of the user in shared-user (= sharedUserId on the consumer side).
  sharedUserId: string;
  // Day and month of the birthday, DDMM (tomorrow when the scheduler runs).
  birthdayDM: string;
  // Year the scheduler ran in: the consumer greets a user once per campaign and
  // year, the same key the mono's scheduler used.
  year: number;
}

// BullMQ prefix of the service that consumes the birthday jobs. The queues of
// shared-user live under its own prefix ('shared_user', app.module.ts), and a
// worker only sees the jobs of its own prefix, so the producer writes under
// the consumer's one.
//
// Empty (the default): the producer is off. It stays off until the consumer
// handles USER_BIRTHDAY_TRIGGERED_JOB and the consumer side stops running its
// own birthday scheduler (step 8.1). Turning it on before that loses greetings:
// both schedulers take the same Redlock key, and the side that wins skips the
// other (issuses/birthday-scheduler-shared-redlock-key.md).
export const USER_BIRTHDAY_QUEUE_PREFIX_ENV = 'USER_BIRTHDAY_QUEUE_PREFIX';
