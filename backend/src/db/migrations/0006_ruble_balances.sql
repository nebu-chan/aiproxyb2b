-- Add ruble-based billing fields to usage_logs
ALTER TABLE "usage_logs"
  ADD COLUMN IF NOT EXISTS "request_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "cost_rub" numeric(12,6),
  ADD COLUMN IF NOT EXISTS "department_id" uuid REFERENCES "departments"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "usage_logs_request_id_idx" ON "usage_logs"("request_id") WHERE "request_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "usage_logs_dept_idx" ON "usage_logs"("department_id");

-- Add ruble balance limit to departments and users
ALTER TABLE "departments"
  ADD COLUMN IF NOT EXISTS "balance_rub" numeric(12,2);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "balance_rub" numeric(12,2);

-- Track billing sync state per AI Mediator key
CREATE TABLE IF NOT EXISTS "billing_sync_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "ai_mediator_key_id" uuid NOT NULL REFERENCES "ai_mediator_keys"("id") ON DELETE CASCADE,
  "synced_through" timestamp NOT NULL,
  "records_synced" integer NOT NULL DEFAULT 0,
  "last_sync_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("ai_mediator_key_id")
);

CREATE INDEX IF NOT EXISTS "billing_sync_log_key_idx" ON "billing_sync_log"("ai_mediator_key_id");
