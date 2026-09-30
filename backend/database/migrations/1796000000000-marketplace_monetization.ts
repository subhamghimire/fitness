import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 10 — Coach marketplace & monetization schema.
 *
 * Seven tables for the bounded marketplace context:
 *
 *   marketplace_products                  ProductModule    (the price list)
 *   marketplace_orders                    OrderModule      (purchase state machine)
 *   marketplace_payments                  PaymentModule    (charge attempts)
 *   marketplace_processed_webhook_events  PaymentModule    (webhook idempotency ledger)
 *   marketplace_entitlements              EntitlementModule (access grants)
 *   marketplace_payouts                   PayoutModule     (coach earnings)
 *   marketplace_audit_logs                MarketplaceAuditModule (append-only trail)
 *
 * ── Decisions that are correctness guarantees, not tuning ─────────────────
 *
 * 1. Money is minor-unit integers with CHECKs, never floats. `price_cents > 0`;
 *    every amount/fee/net column is `>= 0`; payouts additionally enforce
 *    `net = amount − fee` in the database, so a service bug cannot silently
 *    pay the coach the gross or mint money.
 *
 * 2. Idempotency is enforced by UNIQUE constraints, not by application
 *    `find-then-insert` (which races): `(buyer_id, idempotency_key)` on
 *    orders, `idempotency_key` on payments, `(provider, provider_payment_id)`
 *    on payments, `(provider, event_id)` on the webhook ledger, `order_id` on
 *    entitlements and payouts. A repeated webhook collides on the ledger and
 *    is acknowledged without touching business state.
 *
 * 3. The webhook ledger and audit log are append-only: no soft-delete columns,
 *    no updates. A consumed event id must stay consumed forever, and an audit
 *    row must stay written — otherwise a replay or a delete could rewrite
 *    history (and money).
 *
 * 4. NO card data columns exist anywhere. The absence is the guarantee: there
 *    is no PAN/expiry/CVC column to accidentally write to. Payments keep only
 *    opaque provider references (`provider_payment_id`, `payment_method_ref`).
 *
 * 5. Order → product/coach and payout → order/coach are RESTRICT (not CASCADE):
 *    deleting a product or coach must never silently erase the money trail.
 *    Entitlement and payment rows follow the same rule via their order link.
 */
export class MarketplaceMonetization1796000000000 implements MigrationInterface {
  name = "MarketplaceMonetization1796000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ─── marketplace_products ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_products" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "coach_id" uuid NOT NULL REFERENCES "coaches"("id") ON DELETE CASCADE,
        "type" varchar NOT NULL,
        "status" varchar NOT NULL DEFAULT 'draft',
        "title" varchar(200) NOT NULL,
        "description" text,
        "price_cents" int NOT NULL,
        "currency" char(3) NOT NULL DEFAULT 'USD',
        "billing_interval" varchar(16),
        "program_id" uuid REFERENCES "programs"("id") ON DELETE SET NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_products_coach" ON "marketplace_products" ("coach_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_products_status" ON "marketplace_products" ("status")`);
    await this.addCheck(queryRunner, "marketplace_products", "ck_products_price_positive", '"price_cents" > 0');
    await this.addCheck(queryRunner, "marketplace_products", "ck_products_type", '"type" IN (\'training_program\', \'digital_plan\', \'coaching_package\', \'subscription\')');
    await this.addCheck(queryRunner, "marketplace_products", "ck_products_status", '"status" IN (\'draft\', \'active\', \'archived\')');

    // ─── marketplace_orders ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_orders" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "buyer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "coach_id" uuid NOT NULL REFERENCES "coaches"("id") ON DELETE RESTRICT,
        "product_id" uuid NOT NULL REFERENCES "marketplace_products"("id") ON DELETE RESTRICT,
        "amount_cents" int NOT NULL,
        "currency" char(3) NOT NULL DEFAULT 'USD',
        "fee_cents" int NOT NULL DEFAULT 0,
        "net_cents" int NOT NULL DEFAULT 0,
        "status" varchar NOT NULL DEFAULT 'pending',
        "idempotency_key" varchar(120) NOT NULL,
        "provider_payment_id" varchar(120),
        "failure_reason" text,
        "paid_at" TIMESTAMPTZ,
        "refunded_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_orders_buyer" ON "marketplace_orders" ("buyer_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_orders_coach" ON "marketplace_orders" ("coach_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_orders_status" ON "marketplace_orders" ("status")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_orders_buyer_idempotency"
      ON "marketplace_orders" ("buyer_id", "idempotency_key")
    `);
    await this.addCheck(queryRunner, "marketplace_orders", "ck_orders_amounts", '"amount_cents" > 0 AND "fee_cents" >= 0 AND "net_cents" >= 0 AND "fee_cents" <= "amount_cents" AND "net_cents" = "amount_cents" - "fee_cents"');
    await this.addCheck(queryRunner, "marketplace_orders", "ck_orders_status", '"status" IN (\'pending\', \'awaiting_payment\', \'paid\', \'failed\', \'cancelled\', \'refunded\')');

    // ─── marketplace_payments ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_payments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "order_id" uuid NOT NULL REFERENCES "marketplace_orders"("id") ON DELETE RESTRICT,
        "provider" varchar(40) NOT NULL DEFAULT 'mock',
        "provider_payment_id" varchar(120) NOT NULL,
        "amount_cents" int NOT NULL,
        "currency" char(3) NOT NULL DEFAULT 'USD',
        "status" varchar NOT NULL DEFAULT 'created',
        "idempotency_key" varchar(120) NOT NULL,
        "failure_code" varchar(80),
        "failure_message" text,
        "payment_method_ref" varchar(120),
        "refunded_amount_cents" int NOT NULL DEFAULT 0,
        "provider_metadata" jsonb NOT NULL DEFAULT '{}',
        "succeeded_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payments_order" ON "marketplace_payments" ("order_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payments_status" ON "marketplace_payments" ("status")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_payments_provider_payment_id"
      ON "marketplace_payments" ("provider", "provider_payment_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_payments_idempotency_key"
      ON "marketplace_payments" ("idempotency_key")
    `);
    await this.addCheck(queryRunner, "marketplace_payments", "ck_payments_amounts", '"amount_cents" > 0 AND "refunded_amount_cents" >= 0 AND "refunded_amount_cents" <= "amount_cents"');
    await this.addCheck(queryRunner, "marketplace_payments", "ck_payments_status", '"status" IN (\'created\', \'pending\', \'processing\', \'succeeded\', \'partially_refunded\', \'failed\', \'canceled\', \'refunded\')');

    // ─── marketplace_processed_webhook_events (append-only ledger) ──────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_processed_webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "provider" varchar(40) NOT NULL,
        "event_id" varchar(160) NOT NULL,
        "event_type" varchar(80) NOT NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_webhook_provider_event"
      ON "marketplace_processed_webhook_events" ("provider", "event_id")
    `);

    // ─── marketplace_entitlements ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_entitlements" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "buyer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "coach_id" uuid NOT NULL REFERENCES "coaches"("id") ON DELETE RESTRICT,
        "product_id" uuid NOT NULL REFERENCES "marketplace_products"("id") ON DELETE RESTRICT,
        "order_id" uuid NOT NULL REFERENCES "marketplace_orders"("id") ON DELETE RESTRICT,
        "status" varchar NOT NULL DEFAULT 'active',
        "activated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "revoked_at" TIMESTAMPTZ,
        "revoke_reason" varchar(200),
        "expires_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_entitlements_buyer" ON "marketplace_entitlements" ("buyer_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_entitlements_buyer_product" ON "marketplace_entitlements" ("buyer_id", "product_id")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_entitlements_order"
      ON "marketplace_entitlements" ("order_id")
    `);
    await this.addCheck(queryRunner, "marketplace_entitlements", "ck_entitlements_status", '"status" IN (\'active\', \'revoked\', \'expired\')');

    // ─── marketplace_payouts ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_payouts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "coach_id" uuid NOT NULL REFERENCES "coaches"("id") ON DELETE RESTRICT,
        "order_id" uuid NOT NULL REFERENCES "marketplace_orders"("id") ON DELETE RESTRICT,
        "amount_cents" int NOT NULL,
        "fee_cents" int NOT NULL,
        "net_cents" int NOT NULL,
        "currency" char(3) NOT NULL DEFAULT 'USD',
        "status" varchar NOT NULL DEFAULT 'pending',
        "payout_reference" varchar(120) NOT NULL,
        "failure_reason" text,
        "processed_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payouts_coach" ON "marketplace_payouts" ("coach_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payouts_status" ON "marketplace_payouts" ("status")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_payouts_order"
      ON "marketplace_payouts" ("order_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_payouts_reference"
      ON "marketplace_payouts" ("payout_reference")
    `);
    await this.addCheck(queryRunner, "marketplace_payouts", "ck_payouts_amounts", '"amount_cents" > 0 AND "fee_cents" >= 0 AND "net_cents" >= 0 AND "fee_cents" <= "amount_cents" AND "net_cents" = "amount_cents" - "fee_cents"');
    await this.addCheck(queryRunner, "marketplace_payouts", "ck_payouts_status", '"status" IN (\'pending\', \'processing\', \'paid\', \'failed\', \'canceled\')');

    // ─── marketplace_audit_logs (append-only) ───────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "actor_id" uuid,
        "action" varchar(60) NOT NULL,
        "entity_type" varchar(40) NOT NULL,
        "entity_id" varchar(80),
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_marketplace_audit_entity" ON "marketplace_audit_logs" ("entity_type", "entity_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_marketplace_audit_action" ON "marketplace_audit_logs" ("action")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_marketplace_audit_actor" ON "marketplace_audit_logs" ("actor_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order: payouts/entitlements/payments reference orders,
    // orders reference products; the ledger and audit log stand alone.
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_payouts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_entitlements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_processed_webhook_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_products"`);
  }

  private async addCheck(queryRunner: QueryRunner, table: string, name: string, expression: string): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = '${name}' AND conrelid = '${table}'::regclass
        ) THEN
          ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression});
        END IF;
      END $$;
    `);
  }
}
