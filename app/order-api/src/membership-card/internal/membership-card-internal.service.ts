import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, Repository } from 'typeorm';
import { MembershipCard } from '../membership-card.entity';
import { MembershipCardException } from '../membership-card.exception';
import { MembershipCardValidation } from '../membership-card.validation';
import { User } from 'src/user/user.entity';
import { UserRequirement } from 'src/user/user-requirement.entity';
import { UserService } from 'src/user/user.service';
import { UserException } from 'src/user/user.exception';
import { UserValidation } from 'src/user/user.validation';
import {
  UserRequirementKey,
  UserRequirementLevel,
  UserRequirementScope,
  UserRequirementStatus,
} from 'src/user/user.constant';
import { Role } from 'src/role/role.entity';
import { RoleEnum } from 'src/role/role.enum';
import { RoleException } from 'src/role/role.exception';
import { RoleValidation } from 'src/role/role.validation';
import { getUniquePhoneNumber } from 'src/helper';
import { INTERNAL_BATCH_LOOKUP_MAX } from 'src/common/constants/internal-api.constant';
import {
  AssignMembershipCardRequestDto,
  BulkIssueMembershipCardRequestDto,
  LookupMembershipCardRequestDto,
  ReplaceMembershipCardRequestDto,
} from './membership-card-internal.dto';

// QD22 (11/10/2026) - the thanh vien la tai san cua NGUOI, dung chung moi
// service (architect-http.md muc 3). Quyen phat/khoa/thay the kiem o order
// service bang role cua no (khuon QD16); o day chi THI HANH. Chu the la khach
// that => KHONG gan owner_service (QD18: NULL = danh tinh dung chung).
@Injectable()
export class MembershipCardInternalService {
  private readonly saltOfRounds: number;

  constructor(
    @InjectRepository(MembershipCard)
    private readonly membershipCardRepository: Repository<MembershipCard>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
  ) {
    this.saltOfRounds = this.configService.get<number>('SALT_ROUNDS');
  }

  // QD22.c - hop dong the: du field de order service tu anh xa ra
  // MembershipCardResponseDto dang dung (giu shape client-facing - muc 1.4).
  private toCardResponse(card: MembershipCard) {
    return {
      id: card.id,
      slug: card.slug,
      code: card.code,
      userId: card.user?.id ?? null,
      isActive: card.isActive,
      expiredAt: card.expiredAt ?? null,
      createdAt: card.createdAt,
    };
  }

  private notFound(): MembershipCardException {
    return new MembershipCardException(
      MembershipCardValidation.MEMBERSHIP_CARD_NOT_FOUND,
      undefined,
      HttpStatus.NOT_FOUND,
    );
  }

  // Loi trung khoa UNIQUE cua MySQL (`code_column`, `user_column`) - mot lenh
  // khac vua chiem giua buoc kiem va buoc ghi. Cung khuon user.service.ts.
  private isDuplicateEntry(error: unknown): boolean {
    return (error as { code?: string })?.code === 'ER_DUP_ENTRY';
  }

  private async isCodeTaken(code: string): Promise<boolean> {
    return (await this.membershipCardRepository.count({ where: { code } })) > 0;
  }

  private newPendingRequirement(key: UserRequirementKey): UserRequirement {
    const requirement = new UserRequirement();
    requirement.key = key;
    requirement.status = UserRequirementStatus.PENDING;
    requirement.level = UserRequirementLevel.BLOCK;
    requirement.scope = UserRequirementScope.INITIAL;
    return requirement;
  }

  // Phat hanh MOT LO the trong MOT transaction cua shared-user: danh tinh chu
  // the (SDT gia - QD2, owner_service NULL), hai requirement BLOCK/INITIAL/
  // PENDING va hang the. Hong o dau thi ca lo khong co gi - khong con chuoi
  // "N lan POST /internal/users + bu tru" o ben goi.
  //
  // Tra `user` du shape `/internal/users/lookup` (QD22.b) de ben goi cap hang
  // cuc bo (`ensureLocalUsers`) ma khong goi them luot nao.
  async issueBatch(requestData: BulkIssueMembershipCardRequestDto) {
    const context = `${MembershipCardInternalService.name}.${this.issueBatch.name}`;
    const codes = Array.from(new Set(requestData.codes));

    const existed = await this.membershipCardRepository.find({
      where: { code: In(codes) },
    });
    if (existed.length > 0) {
      const taken = existed.map((card) => card.code).join(', ');
      this.logger.warn(
        `Membership card code already exists: ${taken}`,
        context,
      );
      throw new MembershipCardException(
        MembershipCardValidation.MEMBERSHIP_CARD_CODE_ALREADY_EXISTS,
        `Membership card code already exists: ${taken}`,
      );
    }

    const role = await this.roleRepository.findOne({
      where: { name: RoleEnum.Customer },
    });
    if (!role) {
      this.logger.error(`Role not found: ${RoleEnum.Customer}`, null, context);
      throw new RoleException(RoleValidation.ROLE_NOT_FOUND);
    }

    const users = await Promise.all(
      codes.map(async (code) => {
        const card = new MembershipCard();
        card.code = code;
        card.expiredAt = requestData.expiredAt;

        const phonenumber = getUniquePhoneNumber();
        return this.userRepository.create({
          phonenumber,
          role,
          password: await bcrypt.hash(phonenumber, this.saltOfRounds),
          firstName: 'Membership',
          lastName: 'Card',
          isVerifiedPhonenumber: true,
          isActive: true,
          membershipCard: card,
          userRequirements: [
            this.newPendingRequirement(
              UserRequirementKey.NEED_UPDATE_PHONE_NUMBER,
            ),
            this.newPendingRequirement(UserRequirementKey.NEED_UPDATE_PASSWORD),
          ],
        } as User);
      }),
    );

    let saved: User[];
    try {
      saved = await this.dataSource.transaction((manager) =>
        manager.save(users),
      );
    } catch (error) {
      this.logger.error(
        `Error when issuing membership cards: ${error.message}`,
        error.stack,
        context,
      );
      throw new MembershipCardException(
        MembershipCardValidation.ERROR_WHEN_CREATE_MEMBERSHIP_CARDS,
      );
    }
    this.logger.log(`Membership cards issued: ${saved.length}`, context);

    const identities = await this.userService.lookupByIds(
      saved.map((user) => user.id),
    );
    const identityById = new Map(identities.map((u) => [u.id, u]));
    return saved.map((user) => ({
      cardId: user.membershipCard.id,
      code: user.membershipCard.code,
      userId: user.id,
      user: identityById.get(user.id) ?? null,
    }));
  }

  // Gan MOT the cho mot nguoi da co (`userId`). Ma the UNIQUE toan he thong.
  async assign(requestData: AssignMembershipCardRequestDto) {
    const context = `${MembershipCardInternalService.name}.${this.assign.name}`;
    const user = await this.userRepository.findOne({
      where: { id: requestData.userId },
      relations: { membershipCard: true },
    });
    if (!user) throw new UserException(UserValidation.USER_NOT_FOUND);
    if (user.membershipCard) {
      throw new MembershipCardException(
        MembershipCardValidation.USER_ALREADY_HAS_A_MEMBERSHIP_CARD,
      );
    }
    await this.assertCodeFree(requestData.code);

    const card = new MembershipCard();
    card.code = requestData.code;
    card.expiredAt = requestData.expiredAt;
    card.user = user;
    let saved: MembershipCard;
    try {
      saved = await this.membershipCardRepository.save(card);
    } catch (error) {
      // Thua dua UNIQUE (hai lenh gan cung luc) => 4xx dung nghia, khong 500.
      // Hoi lai DB de biet khoa nao vua bi chiem: nguoi da co the hay ma da
      // dung - cung thu tu kiem nhu tren.
      if (this.isDuplicateEntry(error)) {
        this.logger.warn(
          `Assign membership card raced on unique key: ${error.message}`,
          context,
        );
        const userHasCard =
          (await this.membershipCardRepository.count({
            where: { user: { id: user.id } },
          })) > 0;
        throw new MembershipCardException(
          userHasCard
            ? MembershipCardValidation.USER_ALREADY_HAS_A_MEMBERSHIP_CARD
            : MembershipCardValidation.MEMBERSHIP_CARD_CODE_ALREADY_EXISTS,
        );
      }
      throw error;
    }
    this.logger.log(`Membership card assigned: ${saved.slug}`, context);
    return this.toCardResponse(saved);
  }

  // Tra the theo `code` | `userId` (mot the, khong co => 404) hoac `userIds`
  // (mang, nguoi khong co the thi vang mat). Dung o quet the tai quay, loc
  // khach theo ma the (QD22.a) va ghep field `membershipCard` (muc 1.4).
  async lookup(requestData: LookupMembershipCardRequestDto) {
    // "Co mat" = khac undefined/null; chuoi rong da bi DTO chan (400). Chon
    // nhanh bang CUNG phep thu nay, khong bang truthiness: `code: ''` tung roi
    // sang nhanh `userId` dang undefined => TypeORM bo dieu kien => the dau bang.
    const present = (key: unknown) => key !== undefined && key !== null;
    const keys = [requestData.code, requestData.userId, requestData.userIds];
    if (keys.filter(present).length !== 1) {
      throw new BadRequestException(
        'exactly one of code, userId, userIds is required',
      );
    }

    if (present(requestData.userIds)) {
      if (requestData.userIds.length > INTERNAL_BATCH_LOOKUP_MAX) {
        throw new BadRequestException(
          `membership-cards/lookup accepts at most ${INTERNAL_BATCH_LOOKUP_MAX} userIds per call (got ${requestData.userIds.length}) - split the batch on the caller side`,
        );
      }
      if (!requestData.userIds.length) return [];
      const cards = await this.membershipCardRepository.find({
        where: { user: { id: In(requestData.userIds) } },
        relations: { user: true },
      });
      return cards.map((card) => this.toCardResponse(card));
    }

    const card = await this.membershipCardRepository.findOne({
      where: present(requestData.code)
        ? { code: requestData.code }
        : { user: { id: requestData.userId } },
      relations: { user: true },
    });
    if (!card) throw this.notFound();
    return this.toCardResponse(card);
  }

  // Khoa/mo the theo trang thai DICH. Mo mot the da het han => tu choi.
  async setActive(id: string, isActive: boolean) {
    const context = `${MembershipCardInternalService.name}.${this.setActive.name}`;
    const card = await this.membershipCardRepository.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!card) throw this.notFound();
    if (isActive && card.expiredAt && card.expiredAt < new Date()) {
      throw new MembershipCardException(
        MembershipCardValidation.MEMBERSHIP_CARD_EXPIRED,
      );
    }
    card.isActive = isActive;
    const saved = await this.membershipCardRepository.save(card);
    this.logger.log(
      `Membership card ${saved.slug} isActive=${saved.isActive}`,
      context,
    );
    return this.toCardResponse(saved);
  }

  // Thay the cu bang ma moi cho cung nguoi - mot transaction.
  //
  // Ma moi TRUNG chinh the dang cam cua nguoi do thi VAN cho thay (xoa roi tao
  // lai cung ma, han moi) - giu dung hanh vi ban `trend` dang chay: man "thay
  // the" chi quet RFID + chon ngay het han, quet lai the cu de gia han la thao
  // tac that (chot 26/10/2026, luat GD2 "khong doi hanh vi nguoi dung thay").
  async replace(requestData: ReplaceMembershipCardRequestDto) {
    const context = `${MembershipCardInternalService.name}.${this.replace.name}`;
    const user = await this.userRepository.findOne({
      where: { id: requestData.userId },
      relations: { membershipCard: true },
    });
    if (!user) throw new UserException(UserValidation.USER_NOT_FOUND);
    if (!user.membershipCard) throw this.notFound();
    await this.assertCodeFree(requestData.code, user.membershipCard.id);

    let replaced: MembershipCard;
    try {
      replaced = await this.dataSource.transaction(async (manager) => {
        await manager.remove(user.membershipCard);
        const card = new MembershipCard();
        card.code = requestData.code;
        card.expiredAt = requestData.expiredAt;
        card.user = user;
        return manager.save(card);
      });
    } catch (error) {
      // Transaction da rollback - the cu con nguyen. Thua dua UNIQUE ma ma moi
      // nay gio da thuoc the khac => bao trung ma; moi loi khac giu ma loi cua
      // ban `trend` (ERROR_WHEN_REPLACE_MEMBERSHIP_CARD), khong 500.
      this.logger.error(
        `Error when replacing membership card: ${error.message}`,
        error.stack,
        context,
      );
      if (
        this.isDuplicateEntry(error) &&
        (await this.isCodeTaken(requestData.code))
      ) {
        throw new MembershipCardException(
          MembershipCardValidation.MEMBERSHIP_CARD_CODE_ALREADY_EXISTS,
        );
      }
      throw new MembershipCardException(
        MembershipCardValidation.ERROR_WHEN_REPLACE_MEMBERSHIP_CARD,
      );
    }
    this.logger.log(`Membership card replaced: ${replaced.slug}`, context);
    return this.toCardResponse(replaced);
  }

  // Go the khoi nguoi (xoa hang the). Tra lai the vua go.
  async remove(id: string) {
    const context = `${MembershipCardInternalService.name}.${this.remove.name}`;
    const card = await this.membershipCardRepository.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!card) throw this.notFound();
    const response = this.toCardResponse(card);
    await this.membershipCardRepository.remove(card);
    this.logger.log(`Membership card removed: ${response.slug}`, context);
    return response;
  }

  // `exceptCardId`: the dang duoc thay - trung chinh no thi khong tinh la "da
  // dung" (replace cung ma, xem tren).
  private async assertCodeFree(code: string, exceptCardId?: string) {
    const existed = await this.membershipCardRepository.findOne({
      where: { code },
    });
    if (existed && existed.id !== exceptCardId) {
      throw new MembershipCardException(
        MembershipCardValidation.MEMBERSHIP_CARD_CODE_ALREADY_EXISTS,
      );
    }
  }
}
