ALTER TABLE problems_solved
ADD COLUMN IF NOT EXISTS topic_id INTEGER REFERENCES topics(id);

UPDATE problems_solved ps
SET topic_id = ap.topic
FROM all_problems ap
WHERE ps.platform = ap.platform
  AND ps.prob_id = ap.id
  AND ps.topic_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_problems_solved_user_topic
ON problems_solved(user_id, topic_id);
