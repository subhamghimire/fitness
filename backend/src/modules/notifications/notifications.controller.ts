import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import {
  NotificationMarkReadResultDto,
  NotificationPreferenceResponseDto,
  NotificationResponseDto,
  NotificationUnreadCountDto,
  PaginatedNotificationResponseDto
} from "./dto/notification-response.dto";
import { NotificationQueryDto } from "./dto/notification-query.dto";
import { RegisterDeviceTokenDto, UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";
import { NotificationsService } from "./notifications.service";

/**
 * IN-APP NOTIFICATION API
 *
 * Read/pairing surface for the in-app inbox. Delivery to push and email is
 * never triggered from here — those are scheduled by the background pipeline
 * from domain events, never by an HTTP read.
 */
@ApiTags("Notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List my notifications (newest first, paginated)" })
  @ApiResponse({ status: 200, type: PaginatedNotificationResponseDto })
  findAll(@CurrentUser() user: User, @Query() query: NotificationQueryDto): Promise<PaginatedNotificationResponseDto> {
    return this.service.list(user.id, query);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Number of unread notifications" })
  @ApiResponse({ status: 200, type: NotificationUnreadCountDto })
  unreadCount(@CurrentUser() user: User): Promise<NotificationUnreadCountDto> {
    return this.service.unreadCount(user.id);
  }

  @Get("preferences")
  @ApiOperation({ summary: "Read my notification preferences (defaults if never set)" })
  @ApiResponse({ status: 200, type: NotificationPreferenceResponseDto })
  getPreferences(@CurrentUser() user: User): Promise<NotificationPreferenceResponseDto> {
    return this.service.getPreferences(user.id);
  }

  @Put("preferences")
  @ApiOperation({ summary: "Update my notification preferences" })
  @ApiResponse({ status: 200, type: NotificationPreferenceResponseDto })
  updatePreferences(@CurrentUser() user: User, @Body() dto: UpdateNotificationPreferencesDto): Promise<NotificationPreferenceResponseDto> {
    return this.service.updatePreferences(user.id, dto);
  }

  @Post("devices")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Register a push device token (idempotent)" })
  @ApiResponse({ status: 200, type: NotificationPreferenceResponseDto })
  registerDevice(@CurrentUser() user: User, @Body() dto: RegisterDeviceTokenDto): Promise<NotificationPreferenceResponseDto> {
    return this.service.registerDeviceToken(user.id, dto.token);
  }

  @Patch("read-all")
  @ApiOperation({ summary: "Mark every unread notification as read" })
  @ApiResponse({ status: 200, type: NotificationMarkReadResultDto })
  markAllRead(@CurrentUser() user: User): Promise<NotificationMarkReadResultDto> {
    return this.service.markAllRead(user.id);
  }

  @Patch(":id/read")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Mark one notification as read" })
  @ApiResponse({ status: 200, type: NotificationResponseDto })
  markRead(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<NotificationResponseDto> {
    return this.service.markRead(user.id, id);
  }

  @Patch(":id/unread")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Mark one notification as unread again" })
  @ApiResponse({ status: 200, type: NotificationResponseDto })
  markUnread(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<NotificationResponseDto> {
    return this.service.markUnread(user.id, id);
  }
}
