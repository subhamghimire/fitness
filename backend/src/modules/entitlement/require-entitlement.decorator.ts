import { SetMetadata } from "@nestjs/common";

export const ENTITLEMENT_KEY = "entitlement:product-param";

/**
 * Declare which route parameter (or query key) carries the product id that
 * `EntitlementGuard` must check. Example:
 *
 *   @Get("programs/:productId/content")
 *   @RequireEntitlement("productId")
 */
export const RequireEntitlement = (productParam = "productId"): MethodDecorator & ClassDecorator => SetMetadata(ENTITLEMENT_KEY, productParam);
