import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProductService } from "./product.service";
import { Product } from "./entities/product.entity";
import { ProductStatus, ProductType } from "./enums/product.enum";
import { UserRole } from "src/modules/users/enums";

/**
 * PRODUCT SERVICE — ownership and visibility.
 *
 * Writes are coach-scoped (non-coaches get 403, strangers can't touch another
 * coach's rows); the storefront only ever exposes ACTIVE rows.
 */

const OWNER = { id: "owner-1", role: UserRole.USER } as never;
const STRANGER = { id: "stranger-1", role: UserRole.USER } as never;
const ADMIN = { id: "admin-1", role: UserRole.ADMIN } as never;

const draftProduct = (): Product =>
  ({
    id: "prod-1",
    coachId: "coach-1",
    type: ProductType.COACHING_PACKAGE,
    status: ProductStatus.DRAFT,
    title: "4-week coaching",
    description: null,
    priceCents: 5000,
    currency: "USD",
    billingInterval: null,
    programId: null,
    metadata: {},
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date()
  }) as unknown as Product;

const makeService = (product: Product | null = draftProduct()) => {
  const products = {
    findOne: jest.fn((): Promise<Product | null> => Promise.resolve(product)),
    create: jest.fn((d: Partial<Product>): Product => ({ id: "prod-new", isDeleted: false, createdAt: new Date(), updatedAt: new Date(), ...d }) as unknown as Product),
    save: jest.fn((p: Product): Promise<Product> => Promise.resolve(p)),
    createQueryBuilder: jest.fn(() => {
      const qb: Record<string, jest.Mock> = {};
      const self = (): Record<string, jest.Mock> => qb;
      ["where", "andWhere", "orderBy", "skip", "take"].forEach((m) => (qb[m] = jest.fn(self)));
      qb.getManyAndCount = jest.fn((): Promise<[Product[], number]> => Promise.resolve(product?.status === ProductStatus.ACTIVE ? [[product], 1] : [[], 0]));
      return qb;
    })
  };
  const coaches = {
    findOne: jest.fn(({ where }: { where: { userId?: string } }): Promise<unknown> => Promise.resolve(where.userId === "owner-1" ? { id: "coach-1", userId: "owner-1" } : null))
  };
  const audit = { record: jest.fn((): Promise<void> => Promise.resolve()) };
  const entitlements = {
    hasAccess: jest.fn((_buyerId: string, _productId: string): Promise<unknown> => Promise.resolve({ hasAccess: false }))
  };
  const programs = {
    getDetailById: jest.fn((_programId: string): Promise<unknown> => Promise.resolve({ id: "prog-1", name: "programmet" }))
  };
  const service = new ProductService(products as never, coaches as never, audit as never, entitlements as never, programs as never);
  return { service, products, entitlements, programs };
};

describe("create/update authorization", () => {
  it("forbids non-coaches from creating products", async () => {
    const { service } = makeService();
    await expect(service.create(STRANGER, { type: ProductType.DIGITAL_PLAN, title: "Plan", priceCents: 1000 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("creates products as DRAFT scoped to the acting coach", async () => {
    const { service, products } = makeService();
    const created = await service.create(OWNER, { type: ProductType.DIGITAL_PLAN, title: "Plan", priceCents: 1000 });
    expect(products.create).toHaveBeenCalledWith(expect.objectContaining({ coachId: "coach-1", status: ProductStatus.DRAFT }));
    expect(created.status).toBe(ProductStatus.DRAFT);
  });

  it("forbids updating another coach's product", async () => {
    const other = { ...draftProduct(), coachId: "coach-9" } as unknown as Product;
    const { service } = makeService(other);
    await expect(service.update(OWNER, "prod-1", { title: "hijacked" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets admins update any product", async () => {
    const { service } = makeService();
    await expect(service.update(ADMIN, "prod-1", { title: "edited" })).resolves.toMatchObject({ title: "edited" });
  });
});

describe("storefront visibility", () => {
  it("hides DRAFT products from strangers but shows them to the owner", async () => {
    const { service } = makeService(draftProduct());
    await expect(service.findOne(STRANGER, "prod-1")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne(OWNER, "prod-1")).resolves.toMatchObject({ id: "prod-1" });
    await expect(service.findOne(ADMIN, "prod-1")).resolves.toMatchObject({ id: "prod-1" });
  });

  it("shows ACTIVE products to everyone", async () => {
    const { service } = makeService({ ...draftProduct(), status: ProductStatus.ACTIVE } as unknown as Product);
    await expect(service.findOne(STRANGER, "prod-1")).resolves.toMatchObject({ id: "prod-1" });
    await expect(service.findOne(null, "prod-1")).resolves.toMatchObject({ id: "prod-1" });
  });
});

describe("purchased content (Entitlement → Access)", () => {
  const BUYER = { id: "buyer-1", role: UserRole.USER } as never;

  const trainingProduct = () =>
    ({
      ...draftProduct(),
      type: ProductType.TRAINING_PROGRAM,
      status: ProductStatus.ACTIVE,
      programId: "prog-1"
    }) as unknown as Product;

  it("forbids buyers without an active purchase", async () => {
    const { service } = makeService(trainingProduct());
    await expect(service.getContent(BUYER, "prod-1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("resolves full program detail for entitled training-program buyers", async () => {
    const { service, entitlements, programs } = makeService(trainingProduct());
    entitlements.hasAccess.mockResolvedValue({ hasAccess: true, entitlementId: "ent-1", expiresAt: null });
    const content = await service.getContent(BUYER, "prod-1");
    expect(programs.getDetailById).toHaveBeenCalledWith("prog-1");
    expect(content.program).toMatchObject({ id: "prog-1" });
    expect(content.product).toMatchObject({ id: "prod-1" });
  });

  it("returns product-only content for non-program offerings", async () => {
    const { service, entitlements, programs } = makeService({ ...draftProduct(), status: ProductStatus.ACTIVE } as unknown as Product);
    entitlements.hasAccess.mockResolvedValue({ hasAccess: true, entitlementId: "ent-1", expiresAt: null });
    const content = await service.getContent(BUYER, "prod-1");
    expect(content.program).toBeNull();
    expect(programs.getDetailById).not.toHaveBeenCalled();
  });

  it("tolerates a deleted program link instead of 500ing", async () => {
    const { service, entitlements, programs } = makeService(trainingProduct());
    entitlements.hasAccess.mockResolvedValue({ hasAccess: true, entitlementId: "ent-1", expiresAt: null });
    programs.getDetailById.mockRejectedValue(new NotFoundException("Program not found"));
    const content = await service.getContent(BUYER, "prod-1");
    expect(content.program).toBeNull();
    expect(content.product).toMatchObject({ id: "prod-1" });
  });
});
