import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Public } from 'src/auth/decorator/public.decorator';
import { InternalApiGuard } from 'src/common/guards/internal-api.guard';
import { RoleEnum } from 'src/role/role.enum';
import { CreateUserRequestDto } from '../user.dto';
import { UserService } from '../user.service';

interface LookupUserRequest {
  phonenumber?: string;
  id?: string;
}

interface BatchLookupUserRequest {
  ids: string[];
}

interface ListRecentUserRequest {
  createdFrom: string;
  createdTo: string;
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
  async lookup(@Body() body: LookupUserRequest) {
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

  // Dung cho job batch cuoi ngay ben service tieu thu (trend/terminal) tu
  // pull user moi dang ky trong ngay ma chua tung dang nhap vao service do
  // (bu cho khoang tre cua lazy load thuan - xem
  // issuses/sync-user-data-with-role.md muc 6). Tra kem createdAt that -
  // nguon duy nhat de ben goi ghi dung ngay dang ky vao row cuc bo cua no,
  // khong duoc dung gio tao row/gio job chay.
  @Public()
  @Post('list-recent')
  async listRecent(@Body() body: ListRecentUserRequest) {
    if (!body.createdFrom || !body.createdTo) {
      throw new BadRequestException('createdFrom and createdTo are required');
    }
    return this.userService.findRecentlyCreated(
      new Date(body.createdFrom),
      new Date(body.createdTo),
    );
  }

  // Tao identity (phonenumber + mat khau + thong tin ca nhan) khi trend
  // muon tao 1 user moi (vd admin tao nhan vien/khach hang). Trend quyet
  // dinh role/branch va tu luu ban role/branch cua no o local sau khi goi
  // xong route nay - khong dung role tra ve tu day lam nguon that.
  // Tra ve entity tho (giong /internal/users/lookup) thay vi UserResponseDto
  // vi trend can field `id` (UserResponseDto khong co, chi co `slug`) de
  // gan vao shared_user_id_column cua no.
  @Public()
  @Post()
  async createUser(
    @Body(new ValidationPipe({ transform: true }))
    requestData: CreateUserRequestDto,
  ) {
    await this.userService.createUser(requestData, RoleEnum.Admin);
    return this.userService.findByPhonenumber(requestData.phonenumber);
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
}
