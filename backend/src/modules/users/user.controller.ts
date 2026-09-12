import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Query,
  ParseUUIDPipe,
  Put,
  UseGuards,
  ForbiddenException
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiBearerAuth } from "@nestjs/swagger";
import { UserService } from "./user.service";
import {
  UserResponseDto,
  UserQueryDto,
  UpdateUserDto,
  UpdateMeDto,
  ChangePasswordDto,
  PaginatedUserResponseDto
} from "./dto";
import { PaginatedResponseDto } from "src/common/dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "./entities/user.entity";

@ApiTags("Users")
@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the authenticated user's profile" })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async getMe(@CurrentUser() user: User): Promise<UserResponseDto> {
    return this.userService.getProfile(user.id);
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the authenticated user's name, age, and gender" })
  @ApiBody({ type: UpdateMeDto })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async updateMe(@CurrentUser() user: User, @Body() dto: UpdateMeDto): Promise<UserResponseDto> {
    return this.userService.updateMe(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "Get all users with filters and pagination" })
  @ApiResponse({
    status: 200,
    description: "List of users with pagination",
    type: PaginatedUserResponseDto
  })
  async getAll(@Query() query: UserQueryDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    return this.userService.getAll(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get user profile by ID" })
  @ApiParam({ name: "id", description: "User ID", type: "string" })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async getProfile(@Param("id", ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.userService.getProfile(id);
  }

  @Put(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update user details" })
  @ApiParam({ name: "id", description: "User ID", type: "string" })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async updateUser(
    @CurrentUser() actor: User,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto
  ): Promise<UserResponseDto> {
    if (actor.id !== id) throw new ForbiddenException("You can only update your own profile");
    return this.userService.updateUser(id, dto);
  }

  @Patch(":id/enable_disable")
  @ApiOperation({ summary: "Enable or disable a user" })
  @ApiParam({ name: "id", description: "User ID", type: "string" })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async enableDisable(@Param("id", ParseUUIDPipe) id: string) {
    return this.userService.enableDisable(id);
  }

  @Patch(":id/password")
  @ApiOperation({ summary: "Change user password" })
  @ApiParam({ name: "id", description: "User ID", type: "string" })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: "Password changed successfully",
    schema: { example: { success: true } }
  })
  async changePassword(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(id, dto);
  }
}
