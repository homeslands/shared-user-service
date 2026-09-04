import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindManyOptions,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  Like,
  MoreThanOrEqual,
  Raw,
  Repository,
} from 'typeorm';
import { User } from './user.entity';
import { InjectMapper } from '@automapper/nestjs';
import { Mapper } from '@automapper/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import {
  AccountRevenueCustomerResponseDto,
  AccountRevenueQueryResponseDto,
  AccountRevenueStatisticItemDto,
  AccountRevenueStatisticQueryResponseDto,
  AccountRevenueSummaryResponseDto,
  AggregateAccountRevenueResponseDto,
  CompleteUserRegistrationRequestDto,
  CreateUserRequestDto,
  ExportUserQueryRequestDto,
  GetAccountRevenueQueryDto,
  GetAllUserQueryRequestDto,
  GetUserStatisticsQueryRequestDto,
  UpdateUserLanguageRequestDto,
  UpdateUserRequestDto,
  UserResponseDto,
  UserStatisticItemDto,
  UserStatisticsResponseDto,
} from './user.dto';
import { AppPaginatedResponseDto } from 'src/app/app.dto';
import { MailService } from 'src/mail/mail.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Role } from 'src/role/role.entity';
import { UserException } from './user.exception';
import { UserValidation } from './user.validation';
import { RoleValidation } from 'src/role/role.validation';
import { RoleException } from 'src/role/role.exception';
import * as _ from 'lodash';
import { BranchValidation } from 'src/branch/branch.validation';
import { BranchException } from 'src/branch/branch.exception';
import { Branch } from 'src/branch/branch.entity';
import { AuthException } from 'src/auth/auth.exception';
import { AuthValidation } from 'src/auth/auth.validation';
import { RoleEnum } from 'src/role/role.enum';
import { SharedBalanceService } from 'src/shared/services/shared-balance.service';
import { AuthProfileResponseDto } from 'src/auth/auth.dto';
import {
  AccountRevenueCustomerType,
  DobFilterType,
  UserRequirementKey,
  UserRequirementLevel,
  UserRequirementScope,
  UserRequirementStatus,
  UserStatisticsGroupBy,
} from './user.constant';
import {
  getAccountRevenueClause,
  getAccountRevenueStatisticClause,
} from './user.clause';
import { RevenueValidation } from 'src/revenue/revenue.validation';
import { RevenueException } from 'src/revenue/revenue.exception';
import { BranchUtils } from 'src/branch/branch.utils';
import moment from 'moment';
import ExcelJS from 'exceljs';
import { TransactionManagerService } from 'src/db/transaction-manager.service';
import { UserRequirement } from './user-requirement.entity';
import { CampaignAction } from 'src/campaign/campaign.constants';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UserService {
  private saltOfRounds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectMapper()
    private readonly mapper: Mapper,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
    private readonly sharedBalanceService: SharedBalanceService,
    private readonly transactionManagerService: TransactionManagerService,
    private readonly eventEmitter: EventEmitter2,
    private readonly branchUtils: BranchUtils,
  ) {
    this.saltOfRounds = this.configService.get<number>('SALT_ROUNDS');
  }

  private isTodayBirthday(dobDM: string): boolean {
    const today = new Date();
    const todayDM = `${String(today.getDate()).padStart(2, '0')}${String(today.getMonth() + 1).padStart(2, '0')}`;
    return dobDM === todayDM;
  }

  async getUserBySlug(slug: string) {
    const context = `${UserService.name}.${this.getUserBySlug.name}`;
    const user = await this.userRepository.findOne({
      where: {
        slug,
      },
      relations: ['branch', 'role'],
    });

    if (!user) {
      this.logger.error(`User not found`, context);
      throw new UserException(UserValidation.USER_NOT_FOUND);
    }

    return this.mapper.map(user, User, UserResponseDto);
  }

  // Dung cho InternalUserController - tra ve id that cua shared-user de cac
  // service khac (trend) map user cuc bo cua ho sang danh tinh nay. Co kem
  // `isActive` vi khoa/mo khoa tai khoan gio quy het ve shared-user (xem
  // architect-http.md muc 1.1) - trend khong con giu ban isActive cua rieng
  // no, phai hoi lai day moi lan can biet.
  // Field identity tra ve cho InternalUserController - de service khac
  // (trend) ghep vao response cua no khi can ca identity (shared-user) lan
  // role/branch (trend) trong cung 1 endpoint (xem architect-http.md muc
  // 1.1 quy tac 4). Co tinh KHONG tra `role`/`branch` - shared-user khong
  // co khai niem role/branch that, chi trend moi la nguon that.
  private toInternalLookupResponse(user: User) {
    return {
      id: user.id,
      phonenumber: user.phonenumber,
      slug: user.slug,
      isActive: user.isActive,
      firstName: user.firstName,
      lastName: user.lastName,
      dob: user.dob,
      email: user.email,
      address: user.address,
      image: user.image,
      isVerifiedEmail: user.isVerifiedEmail,
      isVerifiedPhonenumber: user.isVerifiedPhonenumber,
      language: user.language,
      // Ngay dang ky that - nguon duy nhat cho createdAt cua row lazy ben
      // service tieu thu (khong dung gio tao row cuc bo/gio job chay), xem
      // issuses/sync-user-data-with-role.md muc 6.3.
      createdAt: user.createdAt,
    };
  }

  async findByPhonenumber(phonenumber: string) {
    const user = await this.userRepository.findOne({ where: { phonenumber } });
    if (!user) return null;
    return this.toInternalLookupResponse(user);
  }

  // Dung cho InternalUserController - JwtStrategy cua service khac (trend)
  // chi co payload.sub (id that cua shared-user, khong co phonenumber trong
  // token) nen can tra cuu nguoc lai theo id de tu tao row cuc bo lan dau
  // user do goi sang (xem issuses/sync-user-data-with-role.md), dong thoi la
  // cho trend hoi trang thai khoa tai khoan moi lan xac thuc.
  async findById(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) return null;
    return this.toInternalLookupResponse(user);
  }

  // Batch cua findById - dung khi trend can ghep identity vao ca 1 trang
  // danh sach user (GET /user ben trend), tranh goi N+1 lan theo tung dong.
  async findByIds(ids: string[]) {
    if (!ids.length) return [];
    const users = await this.userRepository.find({ where: { id: In(ids) } });
    return users.map((user) => this.toInternalLookupResponse(user));
  }

  // Dung cho InternalUserController - job batch cuoi ngay ben service tieu
  // thu (trend/terminal) tu pull user moi tao trong khoang [createdFrom,
  // createdTo) de bu cho khoang tre cua lazy load thuan (user dang ky roi
  // nhung chua tung dang nhap vao service do thi khong co row cuc bo o day).
  // Xem issuses/sync-user-data-with-role.md muc 6.
  async findRecentlyCreated(createdFrom: Date, createdTo: Date) {
    const users = await this.userRepository.find({
      where: { createdAt: Between(createdFrom, createdTo) },
      order: { createdAt: 'ASC' },
    });
    return users.map((user) => this.toInternalLookupResponse(user));
  }

  // Dung cho InternalUserController - sua identity ho 1 service khac (vd
  // trend goi khi admin sua thong tin nhan vien/khach hang qua
  // PATCH /user/:slug, hoac user tu hoan tat dang ky qua
  // PATCH /user/:slug/complete-registration). Tra theo `id` (khong phai
  // slug) vi ben goi chi giu sharedUserId. Chi cho sua field identity - KHONG
  // dong cham role/branch (khong con thuoc ve shared-user).
  async updateIdentityById(
    id: string,
    data: {
      phonenumber?: string;
      firstName?: string;
      lastName?: string;
      dob?: string;
      email?: string;
      address?: string;
      image?: string;
      language?: string;
    },
  ) {
    const context = `${UserService.name}.${this.updateIdentityById.name}`;
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new UserException(UserValidation.USER_NOT_FOUND);

    if (data.phonenumber && data.phonenumber !== user.phonenumber) {
      const existedPhonenumber = await this.userRepository.findOne({
        where: { phonenumber: data.phonenumber },
      });
      if (existedPhonenumber) {
        this.logger.error(
          AuthValidation.PHONE_NUMBER_ALREADY_EXISTS.message,
          null,
          context,
        );
        throw new AuthException(AuthValidation.PHONE_NUMBER_ALREADY_EXISTS);
      }
    }

    Object.assign(user, data);
    if ('dob' in data) {
      const [day, month] = data.dob ? data.dob.split('/') : [];
      user.dobDM = day && month ? `${day}${month}` : null;
    }

    try {
      const updatedUser = await this.userRepository.save(user);
      this.logger.log(`User ${user.id} identity updated`, context);
      return this.toInternalLookupResponse(updatedUser);
    } catch (error) {
      this.logger.error(
        `Error when updating identity: ${error.message}`,
        error.stack,
        context,
      );
      throw new AuthException(AuthValidation.ERROR_UPDATE_USER);
    }
  }

  /**
   * Bu tru (compensating action) cho `POST /internal/users` -
   * architect-http.md muc 1.2 quy tac 5: moi API ghi ma service khac goi
   * toi phai co san 1 cach undo. Ben goi (trend) dung route nay khi da tao
   * identity thanh cong o day nhung buoc luu row cuc bo cua no that bai.
   *
   * KHONG xoa cung hang: dung dung cach ma `AuthService.deleteAccount` da
   * lam san cho luong tu xoa tai khoan - doi phonenumber sang chuoi ngau
   * nhien, xoa cac field identity, tat isActive. Ly do chon cach nay thay
   * vi `repository.delete`:
   * - Tra lai so dien thoai cho lan tao lai - day moi la dieu ben goi thuc
   *   su can, neu khong admin se khong bao gio tao lai duoc user do.
   * - Khong the vo tinh vi pham khoa ngoai (User cua shared-user con ~20
   *   quan he tu thoi monolith), nen duong rollback khong tu no that bai -
   *   dung tinh than muc 1.2 buoc 4.
   *
   * Idempotent: goi lai lan 2 chi doi phonenumber sang mot chuoi ngau nhien
   * khac, khong nem loi.
   */
  async revertCreatedIdentityById(id: string) {
    const context = `${UserService.name}.${this.revertCreatedIdentityById.name}`;
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new UserException(UserValidation.USER_NOT_FOUND);

    user.phonenumber = uuidv4().replace(/-/g, '').slice(0, 20);
    user.firstName = null;
    user.lastName = null;
    user.dob = null;
    user.dobDM = null;
    user.email = null;
    user.address = null;
    user.image = null;
    user.isActive = false;

    try {
      const revertedUser = await this.userRepository.save(user);
      this.logger.log(
        `User ${id} identity reverted after failed create`,
        context,
      );
      return this.toInternalLookupResponse(revertedUser);
    } catch (error) {
      this.logger.error(
        `Error when reverting created identity: ${error.message}`,
        error.stack,
        context,
      );
      throw new AuthException(AuthValidation.ERROR_UPDATE_USER);
    }
  }

  async updateUser(slug: string, requestData: UpdateUserRequestDto) {
    const context = `${UserService.name}.${this.updateUser.name}`;
    const user = await this.userRepository.findOne({
      where: { slug },
      relations: ['branch', 'role'],
    });
    if (!user) throw new UserException(UserValidation.USER_NOT_FOUND);

    Object.assign(user, {
      ...requestData,
    });

    if (requestData.branch) {
      const branch = await this.branchRepository.findOne({
        where: { slug: requestData.branch },
      });
      if (!branch) {
        this.logger.warn(`Branch ${requestData.branch} not found`, context);
        throw new BranchException(BranchValidation.BRANCH_NOT_FOUND);
      }
      user.branch = branch;
    }

    if ('dob' in requestData) {
      const [day, month] = requestData.dob ? requestData.dob.split('/') : [];
      user.dobDM = day && month ? `${day}${month}` : null;
    }
    try {
      const updatedUser = await this.userRepository.save(user);
      this.logger.log(`User ${user.id} updated profile`, context);
      if (
        requestData.dob &&
        updatedUser.dobDM &&
        this.isTodayBirthday(updatedUser.dobDM)
      )
        this.eventEmitter.emit(CampaignAction.USER_BIRTHDAY_TRIGGERED, {
          user: updatedUser,
        });
      return this.mapper.map(updatedUser, User, UserResponseDto);
    } catch (error) {
      this.logger.error(
        `Error when updating user: ${error.message}`,
        error.stack,
        context,
      );
      throw new AuthException(AuthValidation.ERROR_UPDATE_USER);
    }
  }

  async completeUserRegistration(
    userSlug: string,
    requestData: CompleteUserRegistrationRequestDto,
  ) {
    const context = `${UserService.name}.${this.completeUserRegistration.name}`;
    const user = await this.userRepository.findOne({
      where: { slug: userSlug },
      relations: { userRequirements: true },
    });
    if (!user) throw new UserException(UserValidation.USER_NOT_FOUND);

    const blockedPhonenumberRequirement = user.userRequirements.find(
      (requirement) =>
        requirement.key === UserRequirementKey.NEED_UPDATE_PHONE_NUMBER &&
        requirement.status === UserRequirementStatus.PENDING &&
        requirement.level === UserRequirementLevel.BLOCK &&
        requirement.scope === UserRequirementScope.INITIAL,
    );
    // const blockedPasswordRequirement = user.userRequirements.find(
    //   (requirement) =>
    //     requirement.key === UserRequirementKey.NEED_UPDATE_PASSWORD &&
    //     requirement.status === UserRequirementStatus.PENDING &&
    //     requirement.level === UserRequirementLevel.BLOCK &&
    //     requirement.scope === UserRequirementScope.INITIAL,
    // );

    if (blockedPhonenumberRequirement) {
      if (user.phonenumber === requestData.phonenumber) {
        this.logger.warn(
          AuthValidation.NEED_UPDATE_PHONE_NUMBER.message,
          context,
        );
        throw new AuthException(AuthValidation.NEED_UPDATE_PHONE_NUMBER);
      } else {
        const existedPhonenumber = await this.userRepository.findOne({
          where: {
            phonenumber: requestData.phonenumber,
          },
        });
        if (existedPhonenumber) {
          this.logger.error(
            AuthValidation.PHONE_NUMBER_ALREADY_EXISTS.message,
            null,
            context,
          );
          throw new AuthException(AuthValidation.PHONE_NUMBER_ALREADY_EXISTS);
        }
        Object.assign(user, {
          phonenumber: requestData.phonenumber,
        });
        blockedPhonenumberRequirement.status = UserRequirementStatus.COMPLETED;
      }
    }

    // if (blockedPasswordRequirement) {
    //   const isMatch = await bcrypt.compare(requestData.password, user.password);
    //   if (isMatch) {
    //     this.logger.warn(AuthValidation.NEED_UPDATE_PASSWORD.message, context);
    //     throw new AuthException(AuthValidation.NEED_UPDATE_PASSWORD);
    //   } else {
    //     const hashedPass = await bcrypt.hash(
    //       requestData.password,
    //       this.saltOfRounds,
    //     );
    //     Object.assign(user, {
    //       password: hashedPass,
    //     });
    //     blockedPasswordRequirement.status = UserRequirementStatus.COMPLETED;
    //   }
    // }

    // if (!blockedPhonenumberRequirement && !blockedPasswordRequirement) {
    //   this.logger.error(
    //     `User ${user.slug} has no blocked requirement`,
    //     context,
    //   );
    //   throw new AuthException(
    //     AuthValidation.USER_NOT_HAVE_ANY_REQUIREMENT_MUST_BE_COMPLETED,
    //   );
    // }
    if (!blockedPhonenumberRequirement) {
      this.logger.error(
        `User ${user.slug} has no blocked phone number requirement`,
        context,
      );
      throw new AuthException(
        AuthValidation.USER_NOT_HAVE_BLOCKED_PHONE_NUMBER_REQUIREMENT,
      );
    }

    if (!user.isActive) {
      user.isActive = true;
    }

    await this.transactionManagerService.execute<void>(
      async (manager) => {
        await manager.save(user);
        if (blockedPhonenumberRequirement) {
          await manager.save(blockedPhonenumberRequirement);
        }
        // if (blockedPasswordRequirement) {
        //   await manager.save(blockedPasswordRequirement);
        // }
      },
      () => {
        this.logger.log(
          `User ${user.slug} registration has been completed`,
          context,
        );
      },
      (error) => {
        this.logger.warn(
          `Error when completing user registration: ${error.message}`,
          context,
        );
        throw new AuthException(
          AuthValidation.ERROR_COMPLETE_USER_REGISTRATION,
        );
      },
    );
  }

  async createUser(requestData: CreateUserRequestDto, createdRole: string) {
    const context = `${UserService.name}.${this.createUser.name}`;

    // Check if role exists
    const role = await this.roleRepository.findOne({
      where: {
        slug: requestData.role,
      },
    });
    if (!role) {
      this.logger.error(`Role is not found`, null, context);
      throw new RoleException(RoleValidation.ROLE_NOT_FOUND);
    }

    // Check phone number uniqueness
    const userExists = await this.userRepository.findOne({
      where: {
        phonenumber: requestData.phonenumber,
      },
    });
    if (userExists) {
      this.logger.error(`User already exists`, null, context);
      throw new AuthException(AuthValidation.USER_EXISTS);
    }

    const user = this.mapper.map(requestData, CreateUserRequestDto, User);

    const hashedPass = await bcrypt.hash(
      requestData.password,
      this.saltOfRounds,
    );
    Object.assign(user, {
      password: hashedPass,
      role,
    });

    if (requestData.branch) {
      const branch = await this.branchRepository.findOne({
        where: {
          slug: requestData.branch,
        },
      });
      if (!branch) throw new BranchException(BranchValidation.BRANCH_NOT_FOUND);
      user.branch = branch;
    }

    let createdUser = null;
    if (createdRole == RoleEnum.Admin || createdRole == RoleEnum.SuperAdmin) {
      user.isVerifiedPhonenumber = requestData.isVerifiedPhonenumber ?? false;
    } else {
      user.isVerifiedPhonenumber = false;
    }

    try {
      const blockedPhonenumberRequirement = new UserRequirement();
      blockedPhonenumberRequirement.key =
        UserRequirementKey.NEED_UPDATE_PHONE_NUMBER;
      blockedPhonenumberRequirement.status = UserRequirementStatus.COMPLETED;
      blockedPhonenumberRequirement.level = UserRequirementLevel.BLOCK;
      blockedPhonenumberRequirement.scope = UserRequirementScope.INITIAL;

      const blockedPasswordRequirement = new UserRequirement();
      blockedPasswordRequirement.key = UserRequirementKey.NEED_UPDATE_PASSWORD;
      blockedPasswordRequirement.status = UserRequirementStatus.COMPLETED;
      blockedPasswordRequirement.level = UserRequirementLevel.BLOCK;
      blockedPasswordRequirement.scope = UserRequirementScope.INITIAL;

      user.userRequirements = [
        blockedPhonenumberRequirement,
        blockedPasswordRequirement,
      ];
      if (requestData.dob) {
        const [day, month] = requestData.dob.split('/');
        user.dobDM = `${day}${month}`;
      }
      const createdUser = await this.userRepository.save(user);
      this.logger.log(`User has been created successfully`, context);

      if (createdUser) {
        this.eventEmitter.emit(CampaignAction.USER_CREATED, {
          user: createdUser,
        });
        if (user.dobDM && this.isTodayBirthday(user.dobDM))
          this.eventEmitter.emit(CampaignAction.USER_BIRTHDAY_TRIGGERED, {
            user,
          });
      }
    } catch (error) {
      this.logger.error(
        `Error when creating user: ${error.message}`,
        error.stack,
        context,
      );
      throw new UserException(UserValidation.ERROR_CREATE_USER);
    }

    if (createdUser)
      await this.sharedBalanceService.create({ userSlug: createdUser.slug });

    return this.mapper.map(user, User, UserResponseDto);
  }

  async resetPassword(slug: string) {
    const context = `${UserService.name}.${this.resetPassword.name}`;
    const user = await this.userRepository.findOne({
      where: { slug },
    });
    if (!user) throw new UserException(UserValidation.USER_NOT_FOUND);

    const newPassword = Math.random().toString(36).slice(-8);
    const hashedPass = await bcrypt.hash(newPassword, this.saltOfRounds);

    user.password = hashedPass;
    await this.userRepository.save(user);
    this.logger.log(`User password reset for ${user.email}`, context);

    this.mailService.sendNewPassword(user, newPassword);
  }

  async getAllUsers(
    query: GetAllUserQueryRequestDto,
  ): Promise<AppPaginatedResponseDto<UserResponseDto>> {
    // Construct where options
    const whereOptions: FindOptionsWhere<User> = {};
    if (query.slug) whereOptions.slug = query.slug;
    if (query.branch) whereOptions.branch = { slug: query.branch };
    if (query.phonenumber)
      whereOptions.phonenumber = Like(`%${query.phonenumber}%`);
    if (!_.isEmpty(query.role))
      whereOptions.role = {
        name: In(query.role),
      };

    if (query.membershipCard) {
      whereOptions.membershipCard = {
        code: query.membershipCard,
      };
    }

    if (query.startDate && query.endDate) {
      whereOptions.createdAt = Between(
        new Date(query.startDate),
        new Date(query.endDate),
      );
    } else if (query.startDate) {
      whereOptions.createdAt = MoreThanOrEqual(new Date(query.startDate));
    } else if (query.endDate) {
      whereOptions.createdAt = LessThanOrEqual(new Date(query.endDate));
    }

    if (query.birthdayFromDate || query.birthdayToDate) {
      // dobDM is stored as ddmm; reorder to mmdd for correct chronological comparison
      const toMMDD = (ddmm: string) => {
        const [day, month] = ddmm.split('/');
        return `${month}${day}`;
      };
      const fromMMDD = query.birthdayFromDate
        ? toMMDD(query.birthdayFromDate)
        : '0101';
      const toMMDDValue = query.birthdayToDate
        ? toMMDD(query.birthdayToDate)
        : '1231';
      const reorderedExpr = (alias: string) =>
        `CONCAT(SUBSTRING(${alias}, 3, 2), SUBSTRING(${alias}, 1, 2))`;

      whereOptions.dobDM =
        fromMMDD <= toMMDDValue
          ? Raw(
              (alias) =>
                `${alias} IS NOT NULL AND ${reorderedExpr(alias)} BETWEEN :fromMMDD AND :toMMDD`,
              { fromMMDD, toMMDD: toMMDDValue },
            )
          : Raw(
              (alias) =>
                `${alias} IS NOT NULL AND (${reorderedExpr(alias)} >= :fromMMDD OR ${reorderedExpr(alias)} <= :toMMDD)`,
              { fromMMDD, toMMDD: toMMDDValue },
            );
    }

    // Construct find many options
    const findManyOptions: FindManyOptions<User> = {
      relations: {
        branch: true,
        role: true,
        accumulatedPoint: true,
        membershipCard: true,
        balance: true,
        userRequirements: true,
      },
      where: whereOptions,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.size,
      take: query.size,
    };
    if (query.hasPaging) {
      findManyOptions.skip = (query.page - 1) * query.size;
      findManyOptions.take = query.size;
    }

    // Exec query
    const [users, total] =
      await this.userRepository.findAndCount(findManyOptions);

    // Calculate total pages
    const page = query.hasPaging ? query.page : 1;
    const pageSize = query.hasPaging ? query.size : total;
    const totalPages = Math.ceil(total / pageSize);

    // Determine hasNext and hasPrevious
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    return {
      hasNext: hasNext,
      hasPrevios: hasPrevious,
      items: this.mapper.mapArray(users, User, UserResponseDto),
      total,
      page,
      pageSize,
      totalPages,
    } as AppPaginatedResponseDto<UserResponseDto>;
  }

  /**
   * Parse a date-of-birth range bound into a comparable numeric key according to
   * the granularity (`day` | `month` | `day_month`). The year is always ignored.
   * - day: `5` / `05` -> 5
   * - month: `6` / `06` -> 6
   * - day_month: `01/06` (DD/MM) -> 601 (month * 100 + day)
   */
  private parseDobBound(value: string, type: DobFilterType): number {
    if (type === DobFilterType.DAY_MONTH) {
      const match = value.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (!match)
        throw new BadRequestException(
          `Invalid date of birth bound "${value}". Expected DD/MM`,
        );
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      if (day < 1 || day > 31 || month < 1 || month > 12)
        throw new BadRequestException(
          `Invalid date of birth bound "${value}". Day must be 1-31, month 1-12`,
        );
      return month * 100 + day;
    }

    if (!/^\d{1,2}$/.test(value))
      throw new BadRequestException(
        `Invalid date of birth bound "${value}". Expected a number`,
      );
    const num = parseInt(value, 10);
    const max = type === DobFilterType.MONTH ? 12 : 31;
    if (num < 1 || num > max)
      throw new BadRequestException(
        `Invalid date of birth bound "${value}". Must be 1-${max}`,
      );
    return num;
  }

  /**
   * Build a comparable numeric key from a user's `dob` (DD/MM/YYYY string),
   * matching the granularity used by {@link parseDobBound}. Returns null when
   * the dob is missing or invalid.
   */
  private dobToKey(dob: string, type: DobFilterType): number | null {
    const parsed = moment(dob, 'DD/MM/YYYY', true);
    if (!parsed.isValid()) return null;
    const day = parsed.date();
    const month = parsed.month() + 1;
    if (type === DobFilterType.DAY) return day;
    if (type === DobFilterType.MONTH) return month;
    return month * 100 + day;
  }

  /**
   * Export users to an Excel file containing name, phone number and date of birth.
   * Supports filtering by branch, phone number and a date of birth range that
   * matches by day, month or day+month (the year is ignored).
   * Note: `dob` is stored as a `DD/MM/YYYY` string, so the range is filtered in
   * memory after fetching.
   */
  async exportUsersToExcel(query: ExportUserQueryRequestDto): Promise<Buffer> {
    const context = `${UserService.name}.${this.exportUsersToExcel.name}`;

    const whereOptions: FindOptionsWhere<User> = {};
    if (query.phonenumber)
      whereOptions.phonenumber = Like(`%${query.phonenumber}%`);

    if (!_.isEmpty(query.role))
      whereOptions.role = {
        name: In(query.role),
      };

    let users = await this.userRepository.find({
      relations: { branch: true, role: true },
      where: whereOptions,
      order: { createdAt: 'DESC' },
    });

    // Filter by date of birth range (dob stored as DD/MM/YYYY; year ignored)
    if (query.dobStartDate || query.dobEndDate) {
      const type = query.dobFilterType ?? DobFilterType.DAY_MONTH;
      const start = query.dobStartDate
        ? this.parseDobBound(query.dobStartDate, type)
        : null;
      const end = query.dobEndDate
        ? this.parseDobBound(query.dobEndDate, type)
        : null;

      users = users.filter((user) => {
        if (!user.dob) return false;
        const key = this.dobToKey(user.dob, type);
        if (key === null) return false;
        if (start !== null && end !== null) {
          // Support wrap-around ranges (e.g. 25/12 -> 05/01)
          return start <= end
            ? key >= start && key <= end
            : key >= start || key <= end;
        }
        if (start !== null) return key >= start;
        if (end !== null) return key <= end;
        return true;
      });
    }

    // Build workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Users');
    worksheet.columns = [
      { header: 'No.', key: 'index', width: 6 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Phone number', key: 'phonenumber', width: 18 },
      { header: 'Date of birth', key: 'dob', width: 16 },
      { header: 'Role', key: 'role', width: 16 },
    ];
    worksheet.getRow(1).font = { bold: true };

    users.forEach((user, index) => {
      const name = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      worksheet.addRow({
        index: index + 1,
        name: name || 'N/A',
        phonenumber: user.phonenumber || 'N/A',
        dob: user.dob || 'N/A',
        role: user.role.name || 'N/A',
      });
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    this.logger.log(`Exported ${users.length} users to Excel`, context);
    return Buffer.from(arrayBuffer);
  }

  private buildGroupByExpr(groupBy: string): string {
    const col = 'user.created_at_column';
    switch (groupBy) {
      case 'hour':
        return `DATE_FORMAT(${col}, '%Y-%m-%dT%H:00:00')`;
      case 'week':
        return `DATE_FORMAT(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY), '%Y-%m-%dT00:00:00')`;
      case 'month':
        return `DATE_FORMAT(${col}, '%Y-%m-01T00:00:00')`;
      case 'year':
        return `DATE_FORMAT(${col}, '%Y-01-01T00:00:00')`;
      default:
        return `DATE_FORMAT(${col}, '%Y-%m-%dT00:00:00')`;
    }
  }

  async getUserStatistics(
    query: GetUserStatisticsQueryRequestDto,
  ): Promise<UserStatisticsResponseDto> {
    const groupBy = query.groupBy ?? 'day';
    const groupByExpr = this.buildGroupByExpr(groupBy);

    const qb = this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.role', 'role')
      .where('role.name = :roleName', { roleName: RoleEnum.Customer })
      .select(groupByExpr, 'time')
      .addSelect('COUNT(*)', 'count')
      .groupBy(groupByExpr)
      .orderBy(groupByExpr, 'ASC');

    if (query.startDate) {
      qb.andWhere('user.createdAt >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }
    if (query.endDate) {
      qb.andWhere('user.createdAt <= :endDate', {
        endDate: new Date(query.endDate),
      });
    }

    const rawResults = await qb.getRawMany();

    const data: UserStatisticItemDto[] = rawResults.map((r) => ({
      time: String(r.time),
      count: parseInt(r.count, 10),
    }));

    const total = data.reduce((sum, item) => sum + item.count, 0);

    return { data, total };
  }

  async findAllAccountRevenue(
    query: GetAccountRevenueQueryDto,
  ): Promise<AggregateAccountRevenueResponseDto> {
    const context = `${UserService.name}.${this.findAllAccountRevenue.name}`;
    if (!query.branch) {
      this.logger.error(`Branch is not provided`, null, context);
      throw new BadRequestException(`Branch must be provided`);
    }
    const branch = await this.branchUtils.getBranch({
      where: { slug: query.branch },
    });

    const hasStartDate = !!query.startDate;
    const hasEndDate = !!query.endDate;

    if (
      hasStartDate &&
      hasEndDate &&
      new Date(query.startDate).getTime() > new Date(query.endDate).getTime()
    ) {
      this.logger.warn(
        RevenueValidation.START_DATE_ONLY_SMALLER_OR_EQUAL_END_DATE.message,
        context,
      );
      throw new RevenueException(
        RevenueValidation.START_DATE_ONLY_SMALLER_OR_EQUAL_END_DATE,
      );
    }

    // Registered-within-range filter only makes sense with a date range
    const onlyNewCustomers =
      (hasStartDate || hasEndDate) &&
      query.customerType === AccountRevenueCustomerType.NEW_REGISTER;
    const params: string[] = [branch.id];

    // 'YYYY-MM-DDTHH:mm:ss' local time → MySQL datetime literal
    const startParam = query.startDate?.replace('T', ' ');
    const endParam = query.endDate?.replace('T', ' ');
    if (hasStartDate) params.push(startParam);
    if (hasEndDate) params.push(endParam);
    if (onlyNewCustomers) {
      if (hasStartDate) params.push(startParam);
      if (hasEndDate) params.push(endParam);
    }

    if (query.paymentMethod) params.push(query.paymentMethod);

    if (query.phonenumber) params.push(`%${query.phonenumber}%`);

    const clauseOptions = {
      hasStartDate,
      hasEndDate,
      onlyNewCustomers,
      hasPaymentMethod: !!query.paymentMethod,
      hasPhonenumber: !!query.phonenumber,
    };

    const [results, statisticResults]: [
      AccountRevenueQueryResponseDto[],
      AccountRevenueStatisticQueryResponseDto[],
    ] = await Promise.all([
      this.userRepository.query(getAccountRevenueClause(clauseOptions), params),
      this.userRepository.query(
        getAccountRevenueStatisticClause({
          ...clauseOptions,
          groupBy: query.groupBy ?? UserStatisticsGroupBy.DAY,
        }),
        params,
      ),
    ]);

    const customers: AccountRevenueCustomerResponseDto[] = results.map(
      (item) => ({
        customerSlug: item.customerSlug,
        customerName: item.customerName,
        customerRegisteredAt: moment(item.customerRegisteredAt).toDate(),
        totalAmount: Number(item.totalAmount),
        totalAmountPoint: Number(item.totalAmountPoint),
        totalAmountBank: Number(item.totalAmountBank),
        totalAmountCash: Number(item.totalAmountCash),
        totalAmountCreditCard: Number(item.totalAmountCreditCard),
      }),
    );

    const summary = customers.reduce(
      (acc, item) => {
        acc.totalAmount += item.totalAmount;
        acc.totalAmountPoint += item.totalAmountPoint;
        acc.totalAmountBank += item.totalAmountBank;
        acc.totalAmountCash += item.totalAmountCash;
        acc.totalAmountCreditCard += item.totalAmountCreditCard;
        return acc;
      },
      {
        totalAmount: 0,
        totalAmountPoint: 0,
        totalAmountBank: 0,
        totalAmountCash: 0,
        totalAmountCreditCard: 0,
        percentPoint: 0,
        percentBank: 0,
        percentCash: 0,
        percentCreditCard: 0,
      } as AccountRevenueSummaryResponseDto,
    );

    if (summary.totalAmount > 0) {
      const toPercent = (amount: number) =>
        Math.round((amount / summary.totalAmount) * 10000) / 100;
      summary.percentPoint = toPercent(summary.totalAmountPoint);
      summary.percentBank = toPercent(summary.totalAmountBank);
      summary.percentCash = toPercent(summary.totalAmountCash);
      summary.percentCreditCard = toPercent(summary.totalAmountCreditCard);
    }

    const data: AccountRevenueStatisticItemDto[] = statisticResults.map(
      (item) => ({
        time: String(item.time),
        count: Number(item.count),
        countPoint: Number(item.countPoint),
        countBank: Number(item.countBank),
        countCash: Number(item.countCash),
        countCreditCard: Number(item.countCreditCard),
        totalAmount: Number(item.totalAmount),
        totalAmountPoint: Number(item.totalAmountPoint),
        totalAmountBank: Number(item.totalAmountBank),
        totalAmountCash: Number(item.totalAmountCash),
        totalAmountCreditCard: Number(item.totalAmountCreditCard),
      }),
    );
    const total = data.reduce((sum, item) => sum + item.count, 0);

    return { summary, customers, data, total };
  }

  async toggleActiveUser(slug: string) {
    const context = `${UserService.name}.${this.toggleActiveUser.name}`;
    const user = await this.userRepository.findOne({
      where: { slug },
    });
    if (!user) {
      this.logger.warn(`User ${slug} not found`, context);
      throw new UserException(UserValidation.USER_NOT_FOUND);
    }

    user.isActive = !user.isActive;
    await this.userRepository.save(user);
    this.logger.log(`User ${slug} active status has been toggled`, context);
    return this.mapper.map(user, User, UserResponseDto);
  }

  async updateUserLanguage(
    userId: string,
    requestData: UpdateUserLanguageRequestDto,
  ) {
    const context = `${UserService.name}.${this.updateUserLanguage.name}`;
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      this.logger.warn(`User ${userId} not found`, context);
      throw new UserException(UserValidation.USER_NOT_FOUND);
    }
    user.language = requestData.language;
    await this.userRepository.save(user);
    this.logger.log(`User ${user.slug} language has been updated`, context);
    return this.mapper.map(user, User, AuthProfileResponseDto);
  }
}
