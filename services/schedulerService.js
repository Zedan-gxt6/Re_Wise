import { db } from "../db/pool.js";
import {
  calculateConceptPriority,
  calculateRevisionPriority,
  clamp,
} from "../utils/problemUtils.js";

function pickFromBuckets(buckets, difficultyPattern, limit, lockedTopics = null) {
  const selected = [];

  while (selected.length < limit && (buckets.Medium.length || buckets.Easy.length || buckets.Hard.length)) {
    let pickedInRound = false;

    for (const difficulty of difficultyPattern) {
      if (selected.length >= limit) break;

      const bucket = buckets[difficulty];
      const pickIndex = lockedTopics
        ? bucket.findIndex(problem => !problem.topic_id || !lockedTopics.has(problem.topic_id))
        : 0;

      if (pickIndex >= 0) {
        const [picked] = bucket.splice(pickIndex, 1);
        selected.push(picked);
        if (picked.topic_id) lockedTopics?.add(picked.topic_id);
        pickedInRound = true;
      }
    }

    if (!pickedInRound) break;
  }

  return selected;
}

export function arrangeDueProblems(problems, revisionLoad = 4) {
  const scoredProblems = problems.map(calculateRevisionPriority);
  const sortByPriority = (a, b) => b.priority_score - a.priority_score || b.days_since_due - a.days_since_due;
  const emergency = scoredProblems.filter(problem => problem.is_emergency_due).sort(sortByPriority);
  const normalLimit = Math.max(0, Math.floor(revisionLoad) - emergency.length);
  const buckets = {
    Medium: scoredProblems.filter(p => !p.is_emergency_due && p.problem_difficulty === "Medium").sort(sortByPriority),
    Easy: scoredProblems.filter(p => !p.is_emergency_due && p.problem_difficulty === "Easy").sort(sortByPriority),
    Hard: scoredProblems.filter(p => !p.is_emergency_due && p.problem_difficulty === "Hard").sort(sortByPriority),
  };
  const lockedTopics = new Set(emergency.map(problem => problem.topic_id).filter(Boolean));
  const firstPass = pickFromBuckets(buckets, ["Medium", "Easy", "Hard"], normalLimit, lockedTopics);
  const secondPass = pickFromBuckets(buckets, ["Medium", "Easy", "Hard"], normalLimit - firstPass.length);

  return [...emergency, ...firstPass, ...secondPass];
}

export function arrangeDueConcepts(concepts, conceptLoad = 5) {
  return concepts
    .map(calculateConceptPriority)
    .sort((a, b) => b.concept_priority_score - a.concept_priority_score || b.days_since_due - a.days_since_due)
    .slice(0, Math.floor(conceptLoad));
}

export async function getUserRevisionLoad(userId) {
  const result = await db.query("SELECT revision_load FROM users WHERE id = $1", [userId]);
  const revisionLoad = parseFloat(result.rows[0]?.revision_load || 4);
  const clampedLoad = clamp(revisionLoad, 2, 8);

  if (clampedLoad !== revisionLoad) {
    await db.query("UPDATE users SET revision_load = $1 WHERE id = $2", [clampedLoad, userId]);
  }

  return clampedLoad;
}

export async function adjustPastRevisionLoads(userId) {
  const result = await db.query(
    `SELECT plan_date, COUNT(*)::INTEGER AS total_count, COUNT(completed_at)::INTEGER AS completed_count
     FROM revision_daily_plans
     WHERE user_id = $1 AND plan_date < CURRENT_DATE AND load_adjusted = FALSE
     GROUP BY plan_date ORDER BY plan_date ASC`,
    [userId]
  );

  for (const plan of result.rows) {
    const total = parseInt(plan.total_count, 10);
    const completed = parseInt(plan.completed_count, 10);
    const left = total - completed;
    let delta = 0;

    if (total > 0 && completed === total) delta = 0.75;
    else if (total > 0 && left > total / 2) delta = -0.5;

    if (delta !== 0) {
      await db.query(
        `UPDATE users SET revision_load = LEAST(8, GREATEST(2, COALESCE(revision_load, 4) + $1)) WHERE id = $2`,
        [delta, userId]
      );
    }

    await db.query(
      `UPDATE revision_daily_plans SET load_adjusted = TRUE WHERE user_id = $1 AND plan_date = $2`,
      [userId, plan.plan_date]
    );
  }
}

export async function getOrCreateTodayRevisionPlan(userId, dueProblems) {
  await adjustPastRevisionLoads(userId);
  const existingPlan = await db.query(
    `SELECT problem_solved_id FROM revision_daily_plans WHERE user_id = $1 AND plan_date = CURRENT_DATE ORDER BY id ASC`,
    [userId]
  );

  if (existingPlan.rows.length > 0) {
    const dueProblemsById = new Map(dueProblems.map(problem => [problem.id, problem]));
    return existingPlan.rows.map(row => dueProblemsById.get(row.problem_solved_id)).filter(Boolean);
  }

  const revisionLoad = await getUserRevisionLoad(userId);
  const selectedProblems = arrangeDueProblems(dueProblems, revisionLoad);

  for (const problem of selectedProblems) {
    await db.query(
      `INSERT INTO revision_daily_plans (user_id, plan_date, problem_solved_id)
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_id, plan_date, problem_solved_id) DO NOTHING`,
      [userId, problem.id]
    );
  }

  return selectedProblems;
}

export async function markTodayRevisionCompleted(userId, problemSolvedId) {
  await db.query(
    `UPDATE revision_daily_plans
     SET completed_at = COALESCE(completed_at, NOW())
     WHERE user_id = $1 AND problem_solved_id = $2 AND plan_date = CURRENT_DATE`,
    [userId, problemSolvedId]
  );
}

export async function getUserConceptLoad(userId) {
  const result = await db.query("SELECT concept_revision_load FROM users WHERE id = $1", [userId]);
  const conceptLoad = parseFloat(result.rows[0]?.concept_revision_load || 5);
  const clampedLoad = clamp(conceptLoad, 2, 10);

  if (clampedLoad !== conceptLoad) {
    await db.query("UPDATE users SET concept_revision_load = $1 WHERE id = $2", [clampedLoad, userId]);
  }

  return clampedLoad;
}

export async function adjustPastConceptLoads(userId) {
  const result = await db.query(
    `SELECT plan_date, COUNT(*)::INTEGER AS total_count, COUNT(completed_at)::INTEGER AS completed_count
     FROM concept_daily_plans
     WHERE user_id = $1 AND plan_date < CURRENT_DATE AND load_adjusted = FALSE
     GROUP BY plan_date ORDER BY plan_date ASC`,
    [userId]
  );

  for (const plan of result.rows) {
    const total = parseInt(plan.total_count, 10);
    const completed = parseInt(plan.completed_count, 10);
    const left = total - completed;
    let delta = 0;

    if (total > 0 && completed === total) delta = 1;
    else if (total > 0 && left > total / 2) delta = -1;

    if (delta !== 0) {
      await db.query(
        `UPDATE users
         SET concept_revision_load = LEAST(10, GREATEST(2, COALESCE(concept_revision_load, 5) + $1))
         WHERE id = $2`,
        [delta, userId]
      );
    }

    await db.query(
      `UPDATE concept_daily_plans SET load_adjusted = TRUE WHERE user_id = $1 AND plan_date = $2`,
      [userId, plan.plan_date]
    );
  }
}

export async function getOrCreateTodayConceptPlan(userId, dueConcepts) {
  await adjustPastConceptLoads(userId);
  const existingPlan = await db.query(
    `SELECT concept_id FROM concept_daily_plans WHERE user_id = $1 AND plan_date = CURRENT_DATE ORDER BY id ASC`,
    [userId]
  );

  if (existingPlan.rows.length > 0) {
    const dueConceptsById = new Map(dueConcepts.map(concept => [concept.id, calculateConceptPriority(concept)]));
    return existingPlan.rows.map(row => dueConceptsById.get(row.concept_id)).filter(Boolean);
  }

  const conceptLoad = await getUserConceptLoad(userId);
  const selectedConcepts = arrangeDueConcepts(dueConcepts, conceptLoad);

  for (const concept of selectedConcepts) {
    await db.query(
      `INSERT INTO concept_daily_plans (user_id, plan_date, concept_id)
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_id, plan_date, concept_id) DO NOTHING`,
      [userId, concept.id]
    );
  }

  return selectedConcepts;
}

export async function markTodayConceptCompleted(userId, conceptId) {
  await db.query(
    `UPDATE concept_daily_plans
     SET completed_at = COALESCE(completed_at, NOW())
     WHERE user_id = $1 AND concept_id = $2 AND plan_date = CURRENT_DATE`,
    [userId, conceptId]
  );
}
