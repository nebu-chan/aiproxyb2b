-- Add UI locale preference to users (defaults to 'en' to preserve current English-only behavior)
ALTER TABLE users
  ADD COLUMN locale varchar(10) NOT NULL DEFAULT 'en';

-- Constraint: restrict to currently supported locales (extend this list as more languages are added)
ALTER TABLE users
  ADD CONSTRAINT users_locale_check
  CHECK (locale IN ('en', 'ru'));
