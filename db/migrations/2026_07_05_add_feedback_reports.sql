-- Stores user feedback and bug reports from the navbar form.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS feedback_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  status VARCHAR(30) DEFAULT 'new',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_reports_created
  ON feedback_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_reports_user
  ON feedback_reports (user_id);
