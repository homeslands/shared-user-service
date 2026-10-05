import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Public } from 'src/auth/decorator/public.decorator';
import {
  InternalApiGuard,
  InternalRequest,
} from 'src/common/guards/internal-api.guard';
import { INTERNAL_LIST_RECENT_DEFAULT_LIMIT } from 'src/common/constants/internal-api.constant';
import { UserService } from '../user.service';
import {
  CreateInternalUserRequestDto,
  ImportInternalUserRequestDto,
  ListRecentUserRequestDto,
  LookupUserRequestDto,
  ToggleActiveUserRequestDto,
} from './user-internal.dto';

interface BatchLookupUserRequest {
  ids: string[];
}

interface UpdateIdentityRequest {
  phonenumber?: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  email?: string;
  address?: string;
  image?: string;
  // Ngon ngu hien thi cung la identity - PATCH /user/:slug/language ben
  // trend ghi qua day thay vi chi ghi cot cuc bo (architect-http.md muc 1.6).
  language?: string;
}

// Expose POST /internal/users/lookup - dung cho service khac (trend) map
// user cuc bo cua ho sang identity that cua shared-user, tra theo
// phonenumber (khoa dang nhap dung chung) hoac id (payload.sub trong JWT,
// dung khi JwtStrategy chi co id, khong co phonenumber - xem
// issuses/sync-user-data-with-role.md).
@UseGuards(InternalApiGuard)
@Controller('internal/users')
export class UserInternalController {
  constructor(private readonly userService: UserService) {}

  @Public()
  @Post('lookup')
  async lookup(@Body() body: LookupUserRequestDto) {
    if (!body.phonenumber && !body.id) {
      throw new BadRequestException('phonenumber or id is required');
    }
    const user = body.id
      ? await this.userService.findById(body.id)
      : await this.userService.findByPhonenumber(body.phonenumber);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // Batch cua /lookup theo id - dung khi trend can ghep identity vao ca 1
  // trang danh sach user (GET /user ben trend, xem architect-http.md muc
  // 1.1 quy tac 4), tranh goi lookup rieng N+1 lan theo tung dong.
  @Public()
  @Post('batch-lookup')
  async batchLookup(@Body() body: BatchLookupUserRequest) {
    if (!body.ids || !body.ids.length) {
      return [];
    }
    return this.userService.findByIds(body.ids);
  }

  // Duong DONG BO USER CHINH giua cac service (QD19 + QD21): luoi nhanh 10
  // phut cua so 30 phut, luoi rong 1 lan/ngay cua so 48 gio, va sync-on-read
  // cua so 15 phut co throttle. Tra kem createdAt that - nguon duy nhat de
  // ben goi ghi dung ngay dang ky vao row cuc bo cua no, khong duoc dung gio
  // tao row/gio job chay.
  //
  // PHAN TRANG BAT BUOC (`limit`/`offset`): cua so 48 gio co the la vai
  // nghin hang sau mot dot su co. Ben goi lap cho toi khi tra ve it hon
  // `limit` dong.
  @Public()
  @Post('list-recent')
  async listRecent(
    @Body(new ValidationPipe({ transform: true }))
    body: ListRecentUserRequestDto,
  ) {
    const createdFrom = new Date(body.createdFrom);
    const createdTo = new Date(body.createdTo);
    if (createdFrom > createdTo) {
      throw new BadRequestException('createdFrom must not be after createdTo');
    }
    return this.userService.findRecentlyCreated(
      createdFrom,
      createdTo,
      body.limit ?? INTERNAL_LIST_RECENT_DEFAULT_LIMIT,
      body.offset ?? 0,
    );
  }

  // Tao identity (phonenumber + mat khau + thong tin ca nhan) khi service
  // tieu thu muon tao 1 user moi (vd admin tao nhan vien/khach hang ben
  // trend, hoac phat hanh lo the thanh vien).
  //
  // KHONG nhan `role` (QD15): hai he phan quyen doc lap, ben goi khong duoc
  // quyet role cua shared-user. BAT BUOC co `isShared` (QD18) - xem
  // CreateInternalUserRequestDto.
  //
  // Tra ve entity tho (giong /internal/users/lookup) thay vi UserResponseDto
  // vi ben goi can field `id` (UserResponseDto khong co, chi co `slug`) de
  // gan vao shared_user_id_column cua no.
  @Public()
  @Post()
  async createUser(
    @Body(new ValidationPipe({ transform: true }))
    requestData: CreateInternalUserRequestDto,
    @Req() request: InternalRequest,
  ) {
    return this.userService.createInternalUser(
      requestData,
      request.internalService ?? null,
    );
  }

  // NHAP MOT LAN tai khoan da co tu truoc o service tieu thu (vd nhan vien
  // terminal) - giu nguyen hash mat khau, isActive, createdAt. Trung SDT hoac
  // email => 409 (`message` noi ro trung cai nao). Xem
  // UserService.importInternalUser.
  //
  // Duong bu tru: `:id/revert-create` ngay duoi, nhu POST /internal/users.
  @Public()
  @Post('import')
  async importUser(
    @Body(new ValidationPipe({ transform: true }))
    requestData: ImportInternalUserRequestDto,
    @Req() request: InternalRequest,
  ) {
    return this.userService.importInternalUser(
      requestData,
      request.internalService ?? null,
    );
  }

  // Bu tru cho POST /internal/users (architect-http.md muc 1.2 quy tac 5):
  // ben goi da tao identity thanh cong o day nhung buoc luu row cuc bo cua
  // no that bai, nen phai undo lai de 2 ben khong lech. Khong xoa cung hang
  // - tra lai so dien thoai + tat isActive, xem revertCreatedIdentityById.
  //
  // CHI dung cho duong rollback ngay sau khi tao. KHONG dung route nay lam
  // API xoa tai khoan cho nghiep vu binh thuong: xoa tai khoan tu nguyen
  // van di qua DELETE /auth/delete-account (co kiem mat khau).
  @Public()
  @Post(':id/revert-create')
  async revertCreate(@Param('id') id: string) {
    return this.userService.revertCreatedIdentityById(id);
  }

  // Sua identity ho service khac (vd trend goi khi admin sua thong tin
  // nhan vien/khach hang, hoac user tu hoan tat dang ky doi SDT) - tra theo
  // `id` (khong phai slug) vi ben goi chi giu sharedUserId. Chi cho sua field
  // identity - KHONG dong cham role/branch (khong con thuoc ve shared-user).
  @Public()
  @Post(':id/update-identity')
  async updateIdentity(
    @Param('id') id: string,
    @Body() body: UpdateIdentityRequest,
  ) {
    return this.userService.updateIdentityById(id, body);
  }

  // QD16 - dat lai mat khau HO ben goi.
  //
  // **Khong kiem quyen o day, va do la chu y.** Ai duoc phep dat lai mat
  // khau cua nguoi khac la cau hoi ve CHUC VU TRONG CUA HANG - du kien do
  // chi `trend` giu dung. Cua kiem quyen dat o noi giu du kien quyet dinh;
  // shared-user chi THI HANH tren identity. De shared-user tu tra loi la bat
  // no doan bang mot ban role khong ai cap nhat - dung co che sinh ra R1.
  //
  // Nhan `:id` chu khong phai `:slug` (muc 1.3: uu tien id). Day cung la thu
  // xoa han R6: ben goi khong con phai tra nguoc slug theo SDT nua.
  @Public()
  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string) {
    return this.userService.resetPasswordById(id);
  }

  // QD16 - khoa/mo khoa tai khoan HO ben goi. Cung ly do khong kiem quyen
  // nhu reset-password o tren.
  //
  // Nhan `isActive` trong body, KHONG tu dao trang thai: goi lai hai lan
  // phai ra cung mot ket qua. Trang thai khoa van chi co MOT NGUON THAT la
  // shared_user_db - ben goi khong ghi cot nao cua no o duong nay.
  @Public()
  @Post(':id/toggle-active')
  async toggleActive(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    body: ToggleActiveUserRequestDto,
  ) {
    return this.userService.setActiveById(id, body.isActive);
  }
}
