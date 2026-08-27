import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { User } from './user.entity';
import { repositoryMockFactory } from 'src/test-utils/repository-mock.factory';
import { MAPPER_MODULE_PROVIDER } from 'src/app/app.constants';
import { mapperMockFactory } from 'src/test-utils/mapper-mock.factory';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { MailService } from 'src/mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { Role } from 'src/role/role.entity';
import { MailProducer } from 'src/mail/mail.producer';
import { Branch } from 'src/branch/branch.entity';
import { Logger } from '@nestjs/common';
import { Mapper } from '@automapper/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SharedBalanceService } from 'src/shared/services/shared-balance.service';
import { TransactionManagerService } from 'src/db/transaction-manager.service';
import { BranchUtils } from 'src/branch/branch.utils';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        MailService,
        ConfigService,
        MailProducer,
        {
          provide: 'BullQueue_mail',
          useValue: {},
        },
        { provide: MailerService, useValue: {} },
        {
          provide: getRepositoryToken(User),
          useValue: repositoryMockFactory,
        },
        {
          provide: getRepositoryToken(Role),
          useValue: repositoryMockFactory,
        },
        {
          provide: getRepositoryToken(Branch),
          useValue: repositoryMockFactory,
        },
        {
          provide: MAPPER_MODULE_PROVIDER,
          useValue: mapperMockFactory,
        },
        {
          provide: WINSTON_MODULE_NEST_PROVIDER,
          useValue: console,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SALT_ROUNDS') {
                return 10;
              }
              return null;
            }),
          },
        },
        { provide: SharedBalanceService, useValue: {} },
        { provide: TransactionManagerService, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: BranchUtils, useValue: {} },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

// Khoi tao UserService truc tiep (khong qua TestingModule/NestJS DI) - tranh
// phai khai bao lai toan bo dependency phuc tap (SharedBalanceService,
// TransactionManagerService, EventEmitter2, BranchUtils...) chi de test 1
// method chi dung userRepository. Xem issuses/sync-user-data-with-role.md
// muc 6.
describe('UserService.findRecentlyCreated', () => {
  const buildService = (users: Partial<User>[]) => {
    const userRepository = {
      find: jest.fn().mockResolvedValue(users),
    } as unknown as Repository<User>;

    const service = new UserService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as MailService,
      userRepository,
      {} as Repository<Branch>,
      {} as Repository<Role>,
      {} as Mapper,
      console as unknown as Logger,
      {} as SharedBalanceService,
      {} as TransactionManagerService,
      {} as EventEmitter2,
      {} as BranchUtils,
    );

    return { service, userRepository };
  };

  it('queries users with createdAt between the given range, ordered ascending', async () => {
    const { service, userRepository } = buildService([]);
    const from = new Date('2026-08-24T00:00:00.000Z');
    const to = new Date('2026-08-25T00:00:00.000Z');

    await service.findRecentlyCreated(from, to);

    expect(userRepository.find).toHaveBeenCalledWith({
      where: { createdAt: Between(from, to) },
      order: { createdAt: 'ASC' },
    });
  });

  it('maps each user through the internal lookup shape, including createdAt', async () => {
    const createdAt = new Date('2026-08-24T10:00:00.000Z');
    const { service } = buildService([
      {
        id: 'shared-user-1',
        phonenumber: '0900000001',
        slug: 'slug-1',
        isActive: true,
        createdAt,
      } as User,
    ]);

    const result = await service.findRecentlyCreated(
      new Date('2026-08-24T00:00:00.000Z'),
      new Date('2026-08-25T00:00:00.000Z'),
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: 'shared-user-1',
        phonenumber: '0900000001',
        createdAt,
      }),
    ]);
  });

  it('returns an empty array when nothing was created in the range', async () => {
    const { service } = buildService([]);

    const result = await service.findRecentlyCreated(
      new Date('2026-08-24T00:00:00.000Z'),
      new Date('2026-08-25T00:00:00.000Z'),
    );

    expect(result).toEqual([]);
  });
});
