-- Adds optional Google OAuth while keeping username/password login.
-- Safe to run more than once.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(30) DEFAULT 'local';

ALTER TABLE users
  ALTER COLUMN password_hashed DROP NOT NULL;

UPDATE users
SET auth_provider = COALESCE(auth_provider, 'local');

-- Link the existing Zedan account to this email.
-- Google login will attach google_id to this same row on first successful login.
UPDATE users
SET email = 'zedanblr@gmail.com',
    email_verified = TRUE,
    auth_provider = CASE
      WHEN auth_provider = 'google' THEN 'google'
      ELSE 'local_google'
    END
WHERE LOWER(username) = LOWER('Zedan')
  AND (email IS NULL OR LOWER(email) = LOWER('zedanblr@gmail.com'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id_unique
  ON users (google_id)
  WHERE google_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique
  ON users (LOWER(email))
  WHERE email IS NOT NULL;
