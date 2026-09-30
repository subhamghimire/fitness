import { Controller, Get, Post, Body, Param, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { User } from "src/modules/users/entities/user.entity";
import { CreateOrderDto, OrderResponseDto } from "./dto/order.dto";
import { OrderService } from "./order.service";

@ApiTags("Marketplace — Orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders")
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Buyer creates an order for an ACTIVE product (idempotent by idempotencyKey)" })
  @ApiResponse({ status: 201, type: OrderResponseDto })
  create(@CurrentUser() user: User, @Body() dto: CreateOrderDto): Promise<OrderResponseDto> {
    return this.orders.create(user, dto);
  }

  @Get("mine")
  @ApiOperation({ summary: "Buyer lists their own orders" })
  @ApiResponse({ status: 200, type: [OrderResponseDto] })
  listMine(@CurrentUser() user: User): Promise<OrderResponseDto[]> {
    return this.orders.listMine(user);
  }

  @Get("sales")
  @ApiOperation({ summary: "Coach lists sales of their products (admin: all)" })
  @ApiResponse({ status: 200, type: [OrderResponseDto] })
  listSales(@CurrentUser() user: User): Promise<OrderResponseDto[]> {
    return this.orders.listForCoach(user);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an order (buyer, selling coach, or admin)" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  getOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<OrderResponseDto> {
    return this.orders.getForActor(user, id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Buyer cancels an unpaid order" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  cancel(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<OrderResponseDto> {
    return this.orders.cancel(user, id);
  }
}
