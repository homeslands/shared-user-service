import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Public } from 'src/auth/decorator/public.decorator';
import { InternalApiGuard } from 'src/common/guards/internal-api.guard';
import { MembershipCardInternalService } from './membership-card-internal.service';
import {
  AssignMembershipCardRequestDto,
  BulkIssueMembershipCardRequestDto,
  LookupMembershipCardRequestDto,
  ReplaceMembershipCardRequestDto,
  ToggleActiveMembershipCardRequestDto,
} from './membership-card-internal.dto';

// QD22 (buoc 2.4) - /internal/membership-cards/*, khuon user-internal.controller:
// gac HMAC (InternalApiGuard) + @Public() (khong qua JWT), toan POST. Hop dong
// o architect-http.md muc 4.2. Client KHONG goi thang shared-user cho nghiep
// vu the: order service kiem quyen bang role cua no roi goi vao day (QD16).
//
// Khong co route nhap du lieu: the + requirement cua trend da co san o
// shared-user (cung goc mono), terminal khong co du lieu the (chot 12/10/2026).
@UseGuards(InternalApiGuard)
@Controller('internal/membership-cards')
export class MembershipCardInternalController {
  constructor(
    private readonly membershipCardInternalService: MembershipCardInternalService,
  ) {}

  @Public()
  @Post('bulk-issue')
  async bulkIssue(
    @Body(new ValidationPipe({ transform: true }))
    body: BulkIssueMembershipCardRequestDto,
  ) {
    return this.membershipCardInternalService.issueBatch(body);
  }

  @Public()
  @Post()
  async assign(
    @Body(new ValidationPipe({ transform: true }))
    body: AssignMembershipCardRequestDto,
  ) {
    return this.membershipCardInternalService.assign(body);
  }

  @Public()
  @Post('lookup')
  async lookup(
    @Body(new ValidationPipe({ transform: true }))
    body: LookupMembershipCardRequestDto,
  ) {
    return this.membershipCardInternalService.lookup(body);
  }

  @Public()
  @Post(':id/toggle-active')
  async toggleActive(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    body: ToggleActiveMembershipCardRequestDto,
  ) {
    return this.membershipCardInternalService.setActive(id, body.isActive);
  }

  @Public()
  @Post('replace')
  async replace(
    @Body(new ValidationPipe({ transform: true }))
    body: ReplaceMembershipCardRequestDto,
  ) {
    return this.membershipCardInternalService.replace(body);
  }

  @Public()
  @Post(':id/remove')
  async remove(@Param('id') id: string) {
    return this.membershipCardInternalService.remove(id);
  }
}
