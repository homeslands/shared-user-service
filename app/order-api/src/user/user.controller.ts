import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { UserService } from './user.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AppPaginatedResponseDto, AppResponseDto } from 'src/app/app.dto';
import {
  AggregateAccountRevenueResponseDto,
  CompleteUserRegistrationRequestDto,
  CreateUserRequestDto,
  CurrentUserDto,
  ExportUserQueryRequestDto,
  GetAccountRevenueQueryDto,
  GetAllUserQueryRequestDto,
  GetUserStatisticsQueryRequestDto,
  UpdateUserLanguageRequestDto,
  UpdateUserRequestDto,
  UserResponseDto,
  UserStatisticsResponseDto,
} from './user.dto';
import { ApiResponseWithType } from 'src/app/app.decorator';
import { HasRoles } from 'src/role/roles.decorator';
import { RoleEnum } from 'src/role/role.enum';
import { CurrentUser } from './user.decorator';
import { AuthProfileResponseDto } from 'src/auth/auth.dto';
import { UserScheduler } from './user.scheduler';

@Controller('user')
@ApiTags('User')
@ApiBearerAuth()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userScheduler: UserScheduler,
  ) {}

  @Post('birthday/trigger')
  @HasRoles(RoleEnum.Admin, RoleEnum.SuperAdmin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually run the birthday greeting scheduler (for testing)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Birthday greeting scheduler has been triggered successfully',
  })
  async triggerBirthdayScheduler(): Promise<AppResponseDto<void>> {
    await this.userScheduler.BirthdayStrategyScheduler();
    return {
      message: 'Birthday greeting scheduler has been triggered successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
    } as AppResponseDto<void>;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retrieve all user' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'All users have been retrieved successfully',
    type: UserResponseDto,
    isArray: true,
  })
  async getAllUsers(
    @Query(new ValidationPipe({ transform: true }))
    query: GetAllUserQueryRequestDto,
  ): Promise<AppResponseDto<AppPaginatedResponseDto<UserResponseDto>>> {
    const result = await this.userService.getAllUsers(query);
    return {
      message: 'All users have been retrieved successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<AppPaginatedResponseDto<UserResponseDto>>;
  }

  @Post()
  @HasRoles(
    RoleEnum.Staff,
    RoleEnum.Manager,
    RoleEnum.Admin,
    RoleEnum.SuperAdmin,
  )
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create user' })
  @ApiResponseWithType({
    status: HttpStatus.CREATED,
    description: 'User has been created successfully',
    type: UserResponseDto,
  })
  async createUser(
    @Body(new ValidationPipe({ transform: true }))
    requestData: CreateUserRequestDto,
    @CurrentUser(new ValidationPipe({ validateCustomDecorators: true }))
    user: CurrentUserDto,
  ): Promise<AppResponseDto<UserResponseDto>> {
    const result = await this.userService.createUser(
      requestData,
      user?.scope?.role,
    );
    return {
      message: 'User has been created successfully',
      statusCode: HttpStatus.CREATED,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<UserResponseDto>;
  }

  @Post(':slug/reset-password')
  @HasRoles(RoleEnum.Manager, RoleEnum.Admin, RoleEnum.SuperAdmin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset pwd' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'User password has been reset successfully',
    type: UserResponseDto,
  })
  async resetPassword(
    @Param('slug') slug: string,
  ): Promise<AppResponseDto<UserResponseDto>> {
    await this.userService.resetPassword(slug);
    return {
      message: 'User password has been reset successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
    } as AppResponseDto<UserResponseDto>;
  }

  @Patch(':slug')
  @HasRoles(RoleEnum.Manager, RoleEnum.Admin, RoleEnum.SuperAdmin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'User info have been updated successfully',
    type: UserResponseDto,
  })
  async updateUser(
    @Param('slug') slug: string,
    @Body(new ValidationPipe({ transform: true }))
    requestData: UpdateUserRequestDto,
  ) {
    const result = await this.userService.updateUser(slug, requestData);
    return {
      message: 'User has been updated successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<UserResponseDto>;
  }

  @Patch(':slug/complete-registration')
  @HasRoles(
    RoleEnum.Staff,
    RoleEnum.Manager,
    RoleEnum.Admin,
    RoleEnum.SuperAdmin,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete user registration' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'User registration has been completed successfully',
    type: UserResponseDto,
  })
  async completeUserRegistration(
    @Param('slug') slug: string,
    @Body(new ValidationPipe({ transform: true }))
    requestData: CompleteUserRegistrationRequestDto,
  ) {
    await this.userService.completeUserRegistration(slug, requestData);
    return {
      message: 'User registration has been completed successfully',
      statusCode: HttpStatus.NO_CONTENT,
      timestamp: new Date().toISOString(),
    } as AppResponseDto<void>;
  }

  @Get('statistics')
  @HasRoles(RoleEnum.Manager, RoleEnum.Admin, RoleEnum.SuperAdmin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Get customer registration statistics grouped by hour/day/week/month/year',
  })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'Customer statistics have been retrieved successfully',
    type: UserStatisticsResponseDto,
  })
  async getUserStatistics(
    @Query(new ValidationPipe({ transform: true }))
    query: GetUserStatisticsQueryRequestDto,
  ): Promise<AppResponseDto<UserStatisticsResponseDto>> {
    const result = await this.userService.getUserStatistics(query);
    return {
      message: 'Customer statistics have been retrieved successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<UserStatisticsResponseDto>;
  }

  @Get('revenue/account')
  @HasRoles(RoleEnum.Manager, RoleEnum.Admin, RoleEnum.SuperAdmin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get revenue from orders owned by customers with accounts',
  })
  @ApiResponseWithType({
    type: AggregateAccountRevenueResponseDto,
    status: HttpStatus.OK,
    description: 'The account revenues retrieved successfully',
  })
  async findAllAccountRevenue(
    @Query(new ValidationPipe({ transform: true }))
    query: GetAccountRevenueQueryDto,
  ) {
    const result = await this.userService.findAllAccountRevenue(query);
    return {
      message: 'Account revenues have been retrieved successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<AggregateAccountRevenueResponseDto>;
  }

  @Get('export')
  @HasRoles(RoleEnum.Manager, RoleEnum.Admin, RoleEnum.SuperAdmin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Export user information (name, phone number, date of birth) to Excel',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Users have been exported to Excel successfully',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async exportUsersToExcel(
    @Query(new ValidationPipe({ transform: true }))
    query: ExportUserQueryRequestDto,
    @Res() res: Response,
  ) {
    const buffer = await this.userService.exportUsersToExcel(query);
    const filename = `users-${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  }

  @Get(':slug')
  @HasRoles(RoleEnum.SuperAdmin, RoleEnum.Admin, RoleEnum.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retrieve user by slug' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'User has been retrieved successfully',
    type: UserResponseDto,
  })
  async getUserBySlug(
    @Param('slug') slug: string,
  ): Promise<AppResponseDto<UserResponseDto>> {
    const result = await this.userService.getUserBySlug(slug);
    return {
      message: 'User has been retrieved successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<UserResponseDto>;
  }

  @Patch(':slug/toggle-active')
  @HasRoles(RoleEnum.SuperAdmin, RoleEnum.Admin, RoleEnum.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle user active status' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'User active status has been toggled successfully',
    type: UserResponseDto,
  })
  async toggleActiveUser(
    @Param('slug') slug: string,
  ): Promise<AppResponseDto<UserResponseDto>> {
    const result = await this.userService.toggleActiveUser(slug);
    return {
      message: 'User active status has been toggled successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<UserResponseDto>;
  }

  @Patch(':slug/language')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user language' })
  @ApiResponseWithType({
    status: HttpStatus.OK,
    description: 'User language has been updated successfully',
    type: AuthProfileResponseDto,
  })
  async updateUserLanguage(
    @CurrentUser(new ValidationPipe({ validateCustomDecorators: true }))
    currentUserDto: CurrentUserDto,
    @Body(new ValidationPipe({ transform: true }))
    requestData: UpdateUserLanguageRequestDto,
  ): Promise<AppResponseDto<AuthProfileResponseDto>> {
    const result = await this.userService.updateUserLanguage(
      currentUserDto.userId,
      requestData,
    );
    return {
      message: 'User language has been updated successfully',
      statusCode: HttpStatus.OK,
      timestamp: new Date().toISOString(),
      result,
    } as AppResponseDto<AuthProfileResponseDto>;
  }
}
