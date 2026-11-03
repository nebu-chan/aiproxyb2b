CREATE TABLE IF NOT EXISTS "ai_mediator_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "description" varchar(255) NOT NULL DEFAULT '',
  "encrypted_key" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_mediator_keys_org_idx" ON "ai_mediator_keys" ("org_id");

ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "ai_mediator_key_id" uuid REFERENCES "ai_mediator_keys"("id") ON DELETE SET NULL;
