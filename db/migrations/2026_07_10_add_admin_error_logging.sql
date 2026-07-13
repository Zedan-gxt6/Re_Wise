CREATE TABLE IF NOT EXISTS app_errors (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method VARCHAR(12),
  route TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  details JSONB,
  status VARCHAR(30) DEFAULT 'new',
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_errors_created
  ON app_errors (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_errors_status
  ON app_errors (status);

ALTER TABLE feedback_reports
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
