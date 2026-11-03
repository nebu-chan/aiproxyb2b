-- Add billing cycle reset day to organizations (1-28, default 1st of month)
ALTER TABLE organizations
  ADD COLUMN balance_reset_day integer NOT NULL DEFAULT 1;

-- Constraint: must be between 1 and 28 (avoids issues with Feb and 30-day months)
ALTER TABLE organizations
  ADD CONSTRAINT organizations_balance_reset_day_check
  CHECK (balance_reset_day >= 1 AND balance_reset_day <= 28);
