import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "src/modules/users/entities/user.entity";
import { UserRole } from "src/modules/users/enums";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { EntitlementService } from "src/modules/entitlement/entitlement.service";
import { ProgramService } from "src/modules/program/program.service";
import { MarketplaceAuditService } from "src/modules/marketplace/audit/marketplace-audit.service";
import { MarketplaceAuditAction } from "src/modules/marketplace/audit/marketplace-audit.action";
import { CreateProductDto, ProductContentResponseDto, ProductQueryDto, ProductResponseDto, UpdateProductDto } from "./dto/product.dto";
import { Product } from "./entities/product.entity";
import { ProductStatus, ProductType } from "./enums/product.enum";

/**
 * PRODUCT SERVICE — the coach-owned price list.
 *
 * Ownership rule: every write resolves the acting coach from `coaches.user_id`
 * and scopes the row to it. Listing/reading is public but only ever exposes
 * `ACTIVE`, non-deleted rows to strangers; the owning coach (and admins) may
 * see drafts.
 */
@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Coach) private readonly coaches: Repository<Coach>,
    private readonly audit: MarketplaceAuditService,
    private readonly entitlements: EntitlementService,
    private readonly programs: ProgramService
  ) {}

  private async requireCoach(user: User): Promise<Coach> {
    const coach = await this.coaches.findOne({ where: { userId: user.id, isDeleted: false } });
    if (!coach) throw new ForbiddenException("Only coaches can manage products");
    return coach;
  }

  /**
   * Admins may manage any product (support/moderation); coaches may only
   * manage their own. Returns the acting coach id, or null for admins.
   */
  private async coachIdForWrite(user: User): Promise<string | null> {
    if (user.role === UserRole.ADMIN) return null;
    return (await this.requireCoach(user)).id;
  }

  async create(user: User, dto: CreateProductDto): Promise<ProductResponseDto> {
    const coach = await this.requireCoach(user);
    const product = this.products.create({
      coachId: coach.id,
      type: dto.type,
      title: dto.title,
      description: dto.description ?? null,
      priceCents: dto.priceCents,
      currency: (dto.currency ?? "USD").toUpperCase(),
      billingInterval: dto.billingInterval ?? null,
      programId: dto.programId ?? null,
      metadata: dto.metadata ?? {},
      status: ProductStatus.DRAFT
    });
    const saved = await this.products.save(product);
    await this.audit.record(MarketplaceAuditAction.PRODUCT_CREATED, {
      actorId: user.id,
      entityId: saved.id,
      metadata: { coachId: coach.id, type: saved.type, priceCents: saved.priceCents }
    });
    return this.toDto(saved);
  }

  async update(user: User, id: string, dto: UpdateProductDto): Promise<ProductResponseDto> {
    const coachId = await this.coachIdForWrite(user);
    const product = await this.products.findOne({ where: { id, isDeleted: false } });
    if (!product) throw new NotFoundException("Product not found");
    this.assertOwnerOrAdmin(user, product, coachId);
    Object.assign(product, {
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency.toUpperCase() } : {}),
      ...(dto.billingInterval !== undefined ? { billingInterval: dto.billingInterval } : {}),
      ...(dto.programId !== undefined ? { programId: dto.programId } : {}),
      ...(dto.metadata !== undefined ? { metadata: dto.metadata } : {})
    });
    const saved = await this.products.save(product);
    await this.audit.record(MarketplaceAuditAction.PRODUCT_UPDATED, { actorId: user.id, entityId: saved.id });
    return this.toDto(saved);
  }

  /** DRAFT ↔ ACTIVE. ARCHIVED is terminal and can be reached from either. */
  async setActive(user: User, id: string, active: boolean): Promise<ProductResponseDto> {
    const coachId = await this.coachIdForWrite(user);
    const product = await this.products.findOne({ where: { id, isDeleted: false } });
    if (!product) throw new NotFoundException("Product not found");
    this.assertOwnerOrAdmin(user, product, coachId);
    product.status = active ? ProductStatus.ACTIVE : ProductStatus.DRAFT;
    const saved = await this.products.save(product);
    await this.audit.record(active ? MarketplaceAuditAction.PRODUCT_PUBLISHED : MarketplaceAuditAction.PRODUCT_UNPUBLISHED, { actorId: user.id, entityId: saved.id });
    return this.toDto(saved);
  }

  async archive(user: User, id: string): Promise<ProductResponseDto> {
    const coachId = await this.coachIdForWrite(user);
    const product = await this.products.findOne({ where: { id, isDeleted: false } });
    if (!product) throw new NotFoundException("Product not found");
    this.assertOwnerOrAdmin(user, product, coachId);
    product.status = ProductStatus.ARCHIVED;
    const saved = await this.products.save(product);
    await this.audit.record(MarketplaceAuditAction.PRODUCT_ARCHIVED, { actorId: user.id, entityId: saved.id });
    return this.toDto(saved);
  }

  /** Public storefront: ACTIVE rows only. */
  async catalog(query: ProductQueryDto): Promise<{ items: ProductResponseDto[]; total: number; limit: number; offset: number }> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const qb = this.products.createQueryBuilder("p").where("p.isDeleted = false").andWhere("p.status = :status", { status: ProductStatus.ACTIVE });
    if (query.coachId) qb.andWhere("p.coachId = :coachId", { coachId: query.coachId });
    if (query.type) qb.andWhere("p.type = :type", { type: query.type });
    qb.orderBy("p.createdAt", "DESC").skip(offset).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map((r) => this.toDto(r)), total, limit, offset };
  }

  async findOne(user: User | null, id: string): Promise<ProductResponseDto> {
    const product = await this.products.findOne({ where: { id, isDeleted: false } });
    if (!product) throw new NotFoundException("Product not found");
    if (product.status !== ProductStatus.ACTIVE) {
      const coachId = user ? await this.coachIdFor(user) : null;
      const isAdmin = user?.role === UserRole.ADMIN;
      if (!isAdmin && coachId !== product.coachId) throw new NotFoundException("Product not found");
    }
    return this.toDto(product);
  }

  /** The owning coach's full list, including drafts. */
  async findMine(user: User): Promise<ProductResponseDto[]> {
    const coach = await this.requireCoach(user);
    const rows = await this.products.find({ where: { coachId: coach.id, isDeleted: false }, order: { createdAt: "DESC" } });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Purchased-content read — the "Access" end of the marketplace chain for
   * buyers. The route is additionally guarded by `EntitlementGuard`, but this
   * method re-checks access itself: authorization that lives only in the route
   * layer breaks the moment someone reuses the service. Training programs
   * resolve to full program detail; other offering kinds deliver through the
   * product body itself (description/metadata), so `program` is null for them.
   */
  async getContent(user: User, productId: string): Promise<ProductContentResponseDto> {
    const product = await this.products.findOne({ where: { id: productId, isDeleted: false } });
    if (!product) throw new NotFoundException("Product not found");
    const access = await this.entitlements.hasAccess(user.id, product.id);
    if (!access.hasAccess && user.role !== UserRole.ADMIN) throw new ForbiddenException("An active purchase is required to access this content");
    let program: ProductContentResponseDto["program"] = null;
    if (product.type === ProductType.TRAINING_PROGRAM && product.programId) {
      program = await this.programs.getDetailById(product.programId).catch(() => null);
    }
    return { product: this.toDto(product), program, expiresAt: access.expiresAt ?? null };
  }

  private assertOwnerOrAdmin(user: User, product: Product, coachId: string | null): void {
    if (user.role === UserRole.ADMIN) return;
    if (product.coachId !== coachId) throw new ForbiddenException("You do not own this product");
  }

  private async coachIdFor(user: User): Promise<string | null> {
    const coach = await this.coaches.findOne({ where: { userId: user.id, isDeleted: false } });
    return coach?.id ?? null;
  }

  toDto(p: Product): ProductResponseDto {
    return {
      id: p.id,
      coachId: p.coachId,
      type: p.type,
      status: p.status,
      title: p.title,
      description: p.description,
      priceCents: p.priceCents,
      currency: p.currency,
      billingInterval: p.billingInterval,
      programId: p.programId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    };
  }
}
