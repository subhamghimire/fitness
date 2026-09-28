import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import {
  AddParticipantsDto,
  ConversationPageResponseDto,
  ConversationQueryDto,
  ConversationResponseDto,
  CreateDirectConversationDto,
  CreateGroupConversationDto,
  DeliveryStateResponseDto,
  MessagePageResponseDto,
  MessageQueryDto,
  ReadStateResponseDto,
  RemoveParticipantDto,
  SendMessageDto,
  SendMessageResponseDto,
  UpdateConversationDto,
  UpdateDeliveryStateDto,
  UpdateReadStateDto
} from "./dto";
import { MessageReceiptStateDto, MessagingService } from "./messaging.service";

/**
 * CONVERSATION HTTP API
 * ---------------------------------------------------------------------------
 * The REST surface for the same operations the WebSocket gateway exposes, backed
 * by the identical service calls. It is not a fallback in the "deprecated"
 * sense: it is what a client uses to bootstrap (list threads, page history) and
 * what a client without a live socket uses for everything.
 *
 * Authorisation is entirely the service's job — membership, and moderator role
 * where required. The guard here only establishes *who* is calling, so an
 * unauthorised request is denied identically whether it arrives over HTTP or over
 * a socket, including the deliberate 404-for-non-members that keeps the
 * conversation id space from becoming an existence oracle.
 */
@ApiTags("Messaging")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("conversations")
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get()
  @ApiOperation({ summary: "List my conversations, most recently active first" })
  @ApiResponse({ status: 200, type: ConversationPageResponseDto })
  findAll(@CurrentUser() user: User, @Query() query: ConversationQueryDto): Promise<ConversationPageResponseDto> {
    return this.messagingService.listConversations(user.id, query);
  }

  @Post("direct")
  @ApiOperation({ summary: "Open (or return) the one-to-one conversation with a user", description: "Idempotent: repeat calls return the same conversation." })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  createDirect(@CurrentUser() user: User, @Body() dto: CreateDirectConversationDto): Promise<ConversationResponseDto> {
    return this.messagingService.createDirectConversation(user.id, dto);
  }

  @Post("group")
  @ApiOperation({ summary: "Create a group conversation (the caller becomes owner)" })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  createGroup(@CurrentUser() user: User, @Body() dto: CreateGroupConversationDto): Promise<ConversationResponseDto> {
    return this.messagingService.createGroupConversation(user.id, dto);
  }

  @Get(":id")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Get one conversation with its participant roster" })
  @ApiResponse({ status: 200, type: ConversationResponseDto })
  @ApiResponse({ status: 404, description: "No such conversation, or I am not a participant" })
  findOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ConversationResponseDto> {
    return this.messagingService.getConversation(user.id, id);
  }

  @Patch(":id")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Rename a conversation (moderator) and/or mute it for me" })
  @ApiResponse({ status: 200, type: ConversationResponseDto })
  @ApiResponse({ status: 403, description: "Not an owner or admin" })
  @ApiResponse({ status: 404, description: "No such conversation, or I am not a participant" })
  update(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateConversationDto): Promise<ConversationResponseDto> {
    return this.messagingService.updateConversation(user.id, id, dto);
  }

  @Post(":id/participants")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Add participants to a group conversation (moderator only, idempotent)" })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  addParticipants(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AddParticipantsDto): Promise<ConversationResponseDto> {
    return this.messagingService.addParticipants(user.id, id, dto);
  }

  @Delete(":id/participants")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Remove a participant (moderator), or leave the conversation myself" })
  @ApiResponse({ status: 200, description: "Whether a membership was actually removed" })
  removeParticipant(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RemoveParticipantDto): Promise<{ removed: boolean }> {
    return this.messagingService.removeParticipant(user.id, id, dto.userId);
  }

  @Get(":id/messages")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Message history, newest first, keyset-paginated with `before`" })
  @ApiResponse({ status: 200, type: MessagePageResponseDto })
  listMessages(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Query() query: MessageQueryDto): Promise<MessagePageResponseDto> {
    return this.messagingService.listMessages(user.id, id, query);
  }

  @Post(":id/messages")
  @ApiParam({ name: "id" })
  @ApiOperation({
    summary: "Send a message",
    description: "Idempotent on `clientMessageId`. A retried send returns the original message with `duplicate: true` and nothing is broadcast."
  })
  @ApiResponse({ status: 201, type: SendMessageResponseDto })
  @ApiResponse({ status: 404, description: "No such conversation, or I am not a participant" })
  sendMessage(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SendMessageDto): Promise<SendMessageResponseDto> {
    return this.messagingService.sendMessage(user.id, id, dto);
  }

  @Patch(":id/read")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Advance my read mark and recompute my unread count" })
  @ApiResponse({ status: 200, type: ReadStateResponseDto })
  markRead(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateReadStateDto): Promise<ReadStateResponseDto> {
    return this.messagingService.markRead(user.id, id, dto);
  }

  @Patch(":id/delivered")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Report messages received on device (delivery receipts for the sender)" })
  @ApiResponse({ status: 200, type: DeliveryStateResponseDto })
  markDelivered(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryStateDto): Promise<DeliveryStateResponseDto> {
    return this.messagingService.markDelivered(user.id, id, dto);
  }

  @Get(":id/receipts")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Read/delivered state per participant, for 'seen by' ticks" })
  @ApiResponse({ status: 200, description: "Newest state per participant" })
  listReceipts(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<MessageReceiptStateDto[]> {
    return this.messagingService.listReadReceipts(user.id, id);
  }
}
