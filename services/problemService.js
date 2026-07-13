import { db } from "../db/pool.js";
import {
  calculateBaseStrength,
  calculateReviewDays,
  getInitialThreshold,
  getTimeForScoring,
  normalizeDifficulty,
} from "../utils/problemUtils.js";
import {
  getAllTopicsFromCache,
  getProblemByUrlFromCache,
  getTopicFromCache,
  isReferenceCacheReady,
  setProblemInCache,
} from "./cacheService.js";

export async function getTopics() {
  if (isReferenceCacheReady()) return getAllTopicsFromCache();

  const result = await db.query("SELECT id, name FROM topics ORDER BY id");
  return result.rows;
}

export async function getUserDecayConstant(userId, topicId) {
  const result = await db.query(
    `SELECT decay_constant FROM user_constants WHERE user_id = $1 AND topic_id = $2 LIMIT 1`,
    [userId, topicId]
  );

  if (result.rows.length > 0) return parseFloat(result.rows[0].decay_constant);

  const cachedTopic = isReferenceCacheReady() ? getTopicFromCache(topicId) : null;
  let decayConstant = parseFloat(cachedTopic?.decay_constant || 0.03);

  if (!cachedTopic) {
    const fallback = await db.query("SELECT decay_constant FROM topics WHERE id = $1", [topicId]);
    decayConstant = parseFloat(fallback.rows[0]?.decay_constant || 0.03);
  }

  await db.query(
    `INSERT INTO user_constants (user_id, topic_id, decay_constant) VALUES ($1, $2, $3)`,
    [userId, topicId, decayConstant]
  );

  return decayConstant;
}

export async function seedUserConstants(userId) {
  await db.query(
    `INSERT INTO user_constants (user_id, topic_id, decay_constant)
     SELECT $1, t.id, t.decay_constant
     FROM topics t
     WHERE NOT EXISTS (
       SELECT 1 FROM user_constants uc WHERE uc.user_id = $1 AND uc.topic_id = t.id
     )`,
    [userId]
  );
}

export async function findProblemInAllProblems(platform, slug, url) {
  if (isReferenceCacheReady()) {
    const cachedProblem = getProblemByUrlFromCache(platform, slug) || getProblemByUrlFromCache(platform, url);
    if (cachedProblem) return cachedProblem;
  }

  const result = await db.query(
    `SELECT id, title, url, difficulty, topic, platform
     FROM all_problems
     WHERE platform = $1
       AND (TRIM(TRAILING '/' FROM url) = $2 OR url ILIKE $3 OR url ILIKE $4)
     ORDER BY id LIMIT 1`,
    [platform, slug, `%/problems/${slug}/%`, url]
  );

  return result.rows[0] || null;
}

export async function insertAllProblem({ title, url, difficulty, topic, platform }) {
  const result = await db.query(
    `INSERT INTO all_problems (title, url, difficulty, topic, platform)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, url, difficulty, topic, platform`,
    [title, url, difficulty, topic, platform]
  );

  const problem = result.rows[0];
  setProblemInCache(problem);

  return problem;
}

export async function saveSolvedProblem(req, problemLookup) {
  const { rating, time, code, action, ignore_time, mistake_made, hardest_part, hint_1, hint_2, hint_3 } = req.body;
  const problem = problemLookup.problem;
  const chosenTopicId = parseInt(problemLookup.topicId || req.body.topic_override || req.body.topic || problem.topic, 10);
  const status = action === "mastered" ? "MASTERED" : "LEARNING";
  const visibility = req.body.visibility === "private" ? "private" : "public";
  const parsedTime = getTimeForScoring(problem, time, ignore_time);
  const decayConstant = await getUserDecayConstant(req.session.userId, chosenTopicId);
  const baseStrength = calculateBaseStrength(problem.difficulty, rating, parsedTime);
  const currentThreshold = getInitialThreshold(problem.difficulty);
  const reviewDays = status === "MASTERED"
    ? 0
    : calculateReviewDays(baseStrength, currentThreshold, decayConstant);

  const previous = await db.query(
    `SELECT id, created_at, topic_id, status, due_date
     FROM problems_solved
     WHERE prob_id = $1 AND user_id = $2 AND platform = $3
     LIMIT 1`,
    [problem.id, req.session.userId, problemLookup.platform]
  );
  const previousRow = previous.rows[0] || null;

  const existing = await db.query(
    `UPDATE problems_solved
     SET rating = $1,
         time = $2,
         code = $3,
         mistake_made = $4,
         hardest_part = $5,
         hint_1 = $6,
         hint_2 = $7,
         hint_3 = $8,
         base_strength = $9,
         current_threshold = $10,
         last_rev_date = NOW(),
         due_date = NOW() + INTERVAL '1 day' * ($11::INTEGER),
         status = $12,
         visibility = $13,
         revisions_done = 0,
         created_at = NOW(),
         topic_id = $14
     WHERE prob_id = $15
       AND user_id = $16
       AND platform = $17
     RETURNING id, visibility`,
    [
      rating,
      parsedTime,
      code?.trim() || null,
      mistake_made?.trim() || null,
      hardest_part?.trim() || null,
      hint_1?.trim() || null,
      hint_2?.trim() || null,
      hint_3?.trim() || null,
      baseStrength,
      currentThreshold,
      reviewDays,
      status,
      visibility,
      chosenTopicId,
      problem.id,
      req.session.userId,
      problemLookup.platform,
    ]
  );

  if (existing.rows.length > 0) {
    return {
      ...existing.rows[0],
      dashboardCacheEvent: {
        type: "updated",
        problemDifficulty: problem.difficulty,
        topicId: chosenTopicId,
        previousTopicId: previousRow?.topic_id || null,
        previousCreatedAt: previousRow?.created_at || null,
        previousStatus: previousRow?.status || null,
        previousDueDate: previousRow?.due_date || null,
        nextStatus: status,
      },
    };
  }

  const result = await db.query(
    `INSERT INTO problems_solved
       (prob_id, rating, time, code, mistake_made, hardest_part, hint_1, hint_2, hint_3,
        base_strength, current_threshold, last_rev_date, due_date, status, user_id, platform, visibility, topic_id)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW() + INTERVAL '1 day' * ($12::INTEGER), $13, $14, $15, $16, $17)
     RETURNING id, visibility`,
    [
      problem.id,
      rating,
      parsedTime,
      code?.trim() || null,
      mistake_made?.trim() || null,
      hardest_part?.trim() || null,
      hint_1?.trim() || null,
      hint_2?.trim() || null,
      hint_3?.trim() || null,
      baseStrength,
      currentThreshold,
      reviewDays,
      status,
      req.session.userId,
      problemLookup.platform,
      visibility,
      chosenTopicId,
    ]
  );

  return {
    ...result.rows[0],
    dashboardCacheEvent: {
      type: "inserted",
      problemDifficulty: problem.difficulty,
      topicId: chosenTopicId,
      previousTopicId: null,
      previousCreatedAt: null,
      previousStatus: null,
      previousDueDate: null,
      nextStatus: status,
    },
  };
}

export function validateProblemSolveInput(req, res, next) {
  const { rating, time, action, ignore_time } = req.body;
  const parsedTime = parseInt(time, 10);

  if (!req.body.url) return res.status(400).send("Please enter the problem URL");
  if (!["1", "2", "3"].includes(rating)) {
    return res.status(400).send("Please select how independently you solved the problem");
  }
  if (ignore_time !== "on" && (!Number.isInteger(parsedTime) || parsedTime <= 0)) {
    return res.status(400).send("Please record the time taken before adding the problem");
  }
  if (!["schedule", "mastered"].includes(action)) {
    return res.status(400).send("Please choose whether to schedule or fix the problem");
  }

  next();
}

export function validateManualProblemInput(req, res, renderManualProblemMetadata) {
  const { title, difficulty, topic, rating, time, action, ignore_time } = req.body;
  const parsedTime = parseInt(time, 10);
  const topicId = parseInt(topic, 10);
  const normalizedDifficulty = normalizeDifficulty(difficulty);

  if (!title?.trim()) return renderManualProblemMetadata(req, res, "Please enter the exact problem title.", req.body);
  if (!normalizedDifficulty) return renderManualProblemMetadata(req, res, "Please select the platform difficulty.", req.body);
  if (!Number.isInteger(topicId)) return renderManualProblemMetadata(req, res, "Please select the topic bucket.", req.body);
  if (!["1", "2", "3"].includes(rating)) return renderManualProblemMetadata(req, res, "Please select how independently you solved it.", req.body);
  if (ignore_time !== "on" && (!Number.isInteger(parsedTime) || parsedTime <= 0)) {
    return renderManualProblemMetadata(req, res, "Please record the time taken before adding the problem.", req.body);
  }
  if (!["schedule", "mastered"].includes(action)) {
    return renderManualProblemMetadata(req, res, "Please choose whether to schedule or fix the problem.", req.body);
  }

  return null;
}
