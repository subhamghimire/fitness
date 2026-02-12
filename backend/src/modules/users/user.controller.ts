import { Controller, Get, Param, Patch, Body, Query, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from "@nestjs/swagger";
import { UserService } from "./user.service";
import { UserResponseDto, UserQueryDto, UpdateUserDto, ChangePasswordDto, PaginatedUserResponseDto } from "./dto";
import { PaginatedResponseDto } from "src/common/dto";

@ApiTags("Users")
@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

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
  @ApiOperation({ summary: "Update user details" })
  @ApiParam({ name: "id", description: "User ID", type: "string" })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async updateUser(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<UserResponseDto> {
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
