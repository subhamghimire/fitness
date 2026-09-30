import { Controller, Get, Post, Body, Patch, Param, Query, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "src/modules/auth/guards/optional-jwt-auth.guard";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { User } from "src/modules/users/entities/user.entity";
import { EntitlementGuard } from "src/modules/entitlement/entitlement.guard";
import { RequireEntitlement } from "src/modules/entitlement/require-entitlement.decorator";
import { ProductService } from "./product.service";
import {
  CreateProductDto,
  PaginatedProductResponseDto,
  ProductContentResponseDto,
  ProductQueryDto,
  ProductResponseDto,
  PublishProductDto,
  UpdateProductDto
} from "./dto/product.dto";

@ApiTags("Marketplace — Products")
@Controller("products")
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Coach creates a product (starts as DRAFT)" })
  @ApiResponse({ status: 201, type: ProductResponseDto })
  create(@CurrentUser() user: User, @Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return this.products.create(user, dto);
  }

  @Get("coach/mine")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Coach lists their own products (including drafts)" })
  @ApiResponse({ status: 200, type: [ProductResponseDto] })
  findMine(@CurrentUser() user: User): Promise<ProductResponseDto[]> {
    return this.products.findMine(user);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Public storefront catalog (ACTIVE products only)" })
  @ApiResponse({ status: 200, type: PaginatedProductResponseDto })
  catalog(@Query() query: ProductQueryDto, @CurrentUser() _user?: User | null) {
    return this.products.catalog(query);
  }

  @Get(":id")
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Get a product (public if ACTIVE; owner/admin otherwise)" })
  @ApiResponse({ status: 200, type: ProductResponseDto })
  findOne(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user?: User | null): Promise<ProductResponseDto> {
    return this.products.findOne(user ?? null, id);
  }

  @Get(":id/content")
  @UseGuards(JwtAuthGuard, EntitlementGuard)
  @ApiBearerAuth()
  @RequireEntitlement("id")
  @ApiOperation({ summary: "Read purchased content (ACTIVE entitlement required; training programs include full program detail)" })
  @ApiResponse({ status: 200, type: ProductContentResponseDto })
  @ApiResponse({ status: 403, description: "No active purchase for this product" })
  getContent(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ProductContentResponseDto> {
    return this.products.getContent(user, id);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Coach updates their product" })
  @ApiResponse({ status: 200, type: ProductResponseDto })
  update(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto): Promise<ProductResponseDto> {
    return this.products.update(user, id, dto);
  }

  @Post(":id/publish")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Coach publishes/unpublishes a product (DRAFT ↔ ACTIVE)" })
  @ApiResponse({ status: 200, type: ProductResponseDto })
  publish(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: PublishProductDto): Promise<ProductResponseDto> {
    return this.products.setActive(user, id, dto.active);
  }

  @Post(":id/archive")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Coach archives a product (terminal)" })
  @ApiResponse({ status: 200, type: ProductResponseDto })
  archive(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ProductResponseDto> {
    return this.products.archive(user, id);
  }
}
