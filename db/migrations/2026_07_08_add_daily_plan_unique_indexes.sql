-- Required for scheduler ON CONFLICT clauses on existing databases.
-- Safe to run more than once.

WITH duplicate_revision_plans AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, plan_date, problem_solved_id
           ORDER BY id
         ) AS duplicate_rank
  FROM revision_daily_plans
)
DELETE FROM revision_daily_plans
WHERE id IN (
  SELECT id
  FROM duplicate_revision_plans
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS revision_daily_plans_user_id_plan_date_problem_solved_id_key
  ON revision_daily_plans (user_id, plan_date, problem_solved_id);

WITH duplicate_concept_plans AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, plan_date, concept_id
           ORDER BY id
         ) AS duplicate_rank
  FROM concept_daily_plans
)
DELETE FROM concept_daily_plans
WHERE id IN (
  SELECT id
  FROM duplicate_concept_plans
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS concept_daily_plans_user_id_plan_date_concept_id_key
  ON concept_daily_plans (user_id, plan_date, concept_id);
