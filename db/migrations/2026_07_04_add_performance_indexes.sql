-- Speeds up the common Re_Wise reads without changing table data.
-- Safe to run more than once.

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users (username);

CREATE INDEX IF NOT EXISTS idx_problems_solved_user_created
  ON problems_solved (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_problems_solved_user_due_status
  ON problems_solved (user_id, due_date, status);

CREATE INDEX IF NOT EXISTS idx_problems_solved_user_id
  ON problems_solved (user_id, id);

CREATE INDEX IF NOT EXISTS idx_problems_solved_join_problem
  ON problems_solved (platform, prob_id);

CREATE INDEX IF NOT EXISTS idx_problems_solved_user_platform_prob
  ON problems_solved (user_id, platform, prob_id);

CREATE INDEX IF NOT EXISTS idx_all_problems_platform_url
  ON all_problems (platform, url);

CREATE INDEX IF NOT EXISTS idx_all_problems_platform_id
  ON all_problems (platform, id);

CREATE INDEX IF NOT EXISTS idx_all_problems_difficulty
  ON all_problems (difficulty);

CREATE INDEX IF NOT EXISTS idx_concepts_user_due_status
  ON concepts (userid, due_date, status);

CREATE INDEX IF NOT EXISTS idx_concepts_user_created
  ON concepts (userid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_concept_books_user_name
  ON concept_books (user_id, name);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_follows_follower_status
  ON follows (follower_id, status);

CREATE INDEX IF NOT EXISTS idx_follows_following_status
  ON follows (following_id, status);

CREATE INDEX IF NOT EXISTS idx_revision_daily_plans_user_date
  ON revision_daily_plans (user_id, plan_date);

CREATE INDEX IF NOT EXISTS idx_revision_daily_plans_user_problem_date
  ON revision_daily_plans (user_id, problem_solved_id, plan_date);

CREATE INDEX IF NOT EXISTS idx_concept_daily_plans_user_date
  ON concept_daily_plans (user_id, plan_date);

CREATE INDEX IF NOT EXISTS idx_concept_daily_plans_user_concept_date
  ON concept_daily_plans (user_id, concept_id, plan_date);

CREATE INDEX IF NOT EXISTS idx_problem_card_likes_problem_user
  ON problem_card_likes (problem_solved_id, user_id);

CREATE INDEX IF NOT EXISTS idx_problem_card_comments_problem_created
  ON problem_card_comments (problem_solved_id, created_at);

CREATE INDEX IF NOT EXISTS idx_user_constants_user_topic
  ON user_constants (user_id, topic_id);
