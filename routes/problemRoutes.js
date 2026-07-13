import express from "express";
import { db } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  FEEDBACK_RULES,
  INITIAL_THRESHOLDS,
  MAX_REVISIONS,
  calculateBaseStrength,
  calculateReviewDays,
  clamp,
  extractProblemSlug,
  normalizeDifficulty,
  normalizePlatform,
  problemUrlForStorage,
  mapLeetcodeTopic,
  getInitialThreshold,
} from "../utils/problemUtils.js";
import {
  findProblemInAllProblems,
  getTopics,
  getUserDecayConstant,
  insertAllProblem,
  saveSolvedProblem,
  validateManualProblemInput,
  validateProblemSolveInput,
} from "../services/problemService.js";
import { fetchLeetcodeMetadata } from "../services/leetcodeService.js";
import {
  getOrCreateTodayRevisionPlan,
  getUserRevisionLoad,
  markTodayRevisionCompleted,
} from "../services/schedulerService.js";
import { getFollowedProblemCards } from "../services/socialService.js";
import { notifyFollowersProblemSolved } from "../services/notificationService.js";
import {
  updateDashboardCacheForSolvedProblem,
  updateDashboardDueProblems,
} from "../services/dashboardCacheService.js";

const router = express.Router();

function notifyFollowersProblemSolvedSoon(userId, problemSolvedId) {
  setImmediate(() => {
    notifyFollowersProblemSolved(userId, problemSolvedId).catch((error) => {
      console.error("Follower solve notification error:", error);
    });
  });
}

function wasDueProblem(problem) {
  if (!problem?.due_date || problem.status === "MASTERED") return false;
  return new Date(problem.due_date).getTime() <= Date.now();
}

async function renderManualProblemMetadata(req, res, reason, metadata = {}) {
  const topics = await getTopics();
  const extracted = extractProblemSlug(req.body.url);
  const manualMetadata = {
    platform: metadata.platform || extracted?.platform || "other",
    slug: metadata.slug || extracted?.slug || "",
    title: metadata.title || "",
    difficulty: normalizeDifficulty(metadata.difficulty) || "",
    topic: metadata.topic || "",
  };

  if (req.body.solve_form === "1") {
    return res.render("new.ejs", {
      solveMode: true,
      topics,
      followedCards: [],
      solveData: {
        mode: "manual",
        url: req.body.url || "",
        reason,
        ...manualMetadata,
      },
    });
  }

  return res.render("problem_metadata.ejs", {
    reason,
    topics,
    original: {
      url: req.body.url || "",
      rating: req.body.rating || "",
      time: req.body.time || "",
      code: req.body.code || "",
      action: req.body.action || "",
      ignore_time: req.body.ignore_time || "",
      mistake_made: req.body.mistake_made || "",
      hardest_part: req.body.hardest_part || "",
      hint_1: req.body.hint_1 || "",
      hint_2: req.body.hint_2 || "",
      hint_3: req.body.hint_3 || "",
      visibility: req.body.visibility || "public",
    },
    metadata: manualMetadata,
  });
}

async function resolveProblemFromUrl(url) {
  const extracted = extractProblemSlug(url);
  if (!extracted) {
    return {
      mode: "manual",
      reason: "This is not a supported problem URL yet. Fill the metadata manually and I will still track it.",
      metadata: { platform: "other", slug: "", title: "", difficulty: "", topic: "" },
    };
  }

  const platform = normalizePlatform(extracted.platform);
  const existingProblem = await findProblemInAllProblems(platform, extracted.slug, url);

  if (existingProblem) {
    return {
      mode: "known",
      platform,
      slug: extracted.slug,
      problem: existingProblem,
    };
  }

  if (platform === "leetcode") {
    try {
      const metadata = await fetchLeetcodeMetadata(extracted.slug);
      const topic = mapLeetcodeTopic(metadata.topicTags);

      if (!topic) {
        return {
          mode: "manual",
          reason: "LeetCode found the problem, but I could not confidently map its topic. Choose the topic once.",
          metadata: {
            platform,
            slug: metadata.titleSlug,
            title: metadata.title,
            difficulty: normalizeDifficulty(metadata.difficulty),
            topic: "",
          },
        };
      }

      const problem = await insertAllProblem({
        title: metadata.title,
        url: problemUrlForStorage(platform, url, metadata.titleSlug),
        difficulty: normalizeDifficulty(metadata.difficulty),
        topic,
        platform,
      });

      return {
        mode: "known",
        platform,
        slug: metadata.titleSlug,
        problem,
      };
    } catch (error) {
      console.error("LeetCode metadata fetch error:", error);
      return {
        mode: "manual",
        reason: "LeetCode lookup failed right now. Fill the metadata manually and continue.",
        metadata: { platform, slug: extracted.slug, title: "", difficulty: "", topic: "" },
      };
    }
  }

  const reason = platform === "neetcode250"
    ? "This NeetCode problem is outside your stored NeetCode 250 list, so automatic metadata is not supported for it yet."
    : "This platform is not supported automatically yet. Fill the metadata manually and I will store it.";

  return {
    mode: "manual",
    reason,
    metadata: { platform, slug: extracted.slug, title: "", difficulty: "", topic: "" },
  };
}

async function applyTopicOverride(req) {
  const topicOverride = parseInt(req.body.topic_override, 10);
  if (!Number.isInteger(topicOverride) || !req.problemLookup?.problem?.id) return;

  const currentTopic = parseInt(req.problemLookup.problem.topic, 10);
  if (topicOverride !== currentTopic) {
    await db.query(
      "UPDATE all_problems SET topic = $1 WHERE id = $2 AND platform = $3",
      [topicOverride, req.problemLookup.problem.id, req.problemLookup.platform]
    );
    req.problemLookup.problem.topic = topicOverride;
  }

  req.problemLookup.topicId = topicOverride;
}

async function attachProblemFromUrl(req, res, next) {
  const submittedProblemId = parseInt(req.body.problem_id, 10);
  const submittedPlatform = normalizePlatform(req.body.platform);

  if (Number.isInteger(submittedProblemId) && submittedPlatform) {
    try {
      const result = await db.query(
        `SELECT id, title, url, difficulty, topic, platform
         FROM all_problems
         WHERE id = $1 AND platform = $2
         LIMIT 1`,
        [submittedProblemId, submittedPlatform]
      );

      if (result.rows.length > 0) {
        req.problemLookup = {
          platform: submittedPlatform,
          slug: req.body.slug || extractProblemSlug(req.body.url)?.slug || "",
          problem: result.rows[0],
        };
        return next();
      }
    } catch (error) {
      console.error("Submitted problem lookup error:", error);
    }
  }

  const extracted = extractProblemSlug(req.body.url);
  if (!extracted) {
    return renderManualProblemMetadata(
      req,
      res,
      "I could not read this URL automatically. Add the metadata manually once and I will store it."
    );
  }

  try {
    const platform = normalizePlatform(extracted.platform);
    const existingProblem = await findProblemInAllProblems(platform, extracted.slug, req.body.url);

    if (existingProblem) {
      req.problemLookup = { platform, slug: extracted.slug, problem: existingProblem };
      return next();
    }

    if (platform === "leetcode") {
      try {
        const metadata = await fetchLeetcodeMetadata(extracted.slug);
        const topic = mapLeetcodeTopic(metadata.topicTags);

        if (!topic) {
          return renderManualProblemMetadata(
            req,
            res,
            "LeetCode metadata was found, but I could not confidently map its topic.",
            { platform, slug: metadata.titleSlug, title: metadata.title, difficulty: metadata.difficulty }
          );
        }

        const problem = await insertAllProblem({
          title: metadata.title,
          url: problemUrlForStorage(platform, req.body.url, metadata.titleSlug),
          difficulty: normalizeDifficulty(metadata.difficulty),
          topic,
          platform,
        });

        req.problemLookup = { platform, slug: metadata.titleSlug, problem };
        return next();
      } catch (error) {
        console.error("LeetCode metadata fetch error:", error);
        return renderManualProblemMetadata(
          req,
          res,
          "LeetCode API lookup failed, so add the metadata manually.",
          { platform, slug: extracted.slug }
        );
      }
    }

    const reason = platform === "neetcode250"
      ? "This NeetCode problem is not in your NeetCode 250 list. Add metadata manually if you still want to track it."
      : "This platform is not supported automatically yet. Add the metadata manually once and I will track it.";

    return renderManualProblemMetadata(req, res, reason, { platform, slug: extracted.slug });
  } catch (error) {
    console.error("Problem lookup error:", error);
    return renderManualProblemMetadata(
      req,
      res,
      "Something failed during automatic lookup. Add metadata manually and I will continue.",
      { platform: extracted.platform, slug: extracted.slug }
    );
  }
}

router.get("/new", requireAuth, (req, res) => res.redirect("/dashboard"));

router.get("/solve", requireAuth, async (req, res) => {
  const url = (req.query.url || "").trim();
  if (!url) return res.redirect("/dashboard");

  try {
    const topics = await getTopics();
    const result = await resolveProblemFromUrl(url);
    const followedCards = result.mode === "known"
      ? await getFollowedProblemCards(req.session.userId, result.platform, result.problem.id)
      : [];

    const solveData = result.mode === "known"
      ? {
          mode: "known",
          url,
          platform: result.platform,
          slug: result.slug,
          problemId: result.problem.id,
          title: result.problem.title,
          difficulty: normalizeDifficulty(result.problem.difficulty),
          topic: result.problem.topic,
          reason: "",
        }
      : {
          mode: "manual",
          url,
          platform: result.metadata.platform,
          slug: result.metadata.slug,
          title: result.metadata.title,
          difficulty: result.metadata.difficulty,
          topic: result.metadata.topic,
          reason: result.reason,
        };

    res.render("new.ejs", { solveMode: true, solveData, topics, followedCards });
  } catch (error) {
    console.error("Solve flow error:", error);
    const topics = await getTopics();
    res.render("new.ejs", {
      solveMode: true,
      topics,
      followedCards: [],
      solveData: {
        mode: "manual",
        url,
        platform: "other",
        slug: "",
        title: "",
        difficulty: "",
        topic: "",
        reason: "Automatic lookup failed. Fill the metadata manually and continue.",
      },
    });
  }
});

router.get("/problems/filter", requireAuth, async (req, res) => {
  const filters = {
    topic: req.query.topic || "",
    time_range: req.query.time_range || "",
    independence: req.query.independence || "",
    difficulty: req.query.difficulty || "",
    status: req.query.status || "",
    platform: req.query.platform || "",
    title: String(req.query.title || "").trim(),
  };
  const where = ["ps.user_id = $1"];
  const values = [req.session.userId];

  if (filters.topic) {
    values.push(parseInt(filters.topic, 10));
    where.push(`COALESCE(ps.topic_id, ap.topic) = $${values.length}`);
  }
  if (filters.independence) {
    values.push(parseInt(filters.independence, 10));
    where.push(`ps.rating = $${values.length}`);
  }
  if (["Easy", "Medium", "Hard"].includes(filters.difficulty)) {
    values.push(filters.difficulty);
    where.push(`ap.difficulty = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`COALESCE(ps.status, 'LEARNING') = $${values.length}`);
  }
  if (filters.platform) {
    values.push(filters.platform);
    where.push(`ps.platform = $${values.length}`);
  }
  if (filters.title) {
    values.push(`%${filters.title}%`);
    where.push(`ap.title ILIKE $${values.length}`);
  }
  if (filters.time_range === "below_15") where.push("COALESCE(ps.time, 0) < 15 * 60");
  else if (filters.time_range === "15_30") where.push("COALESCE(ps.time, 0) >= 15 * 60 AND COALESCE(ps.time, 0) <= 30 * 60");
  else if (filters.time_range === "above_30") where.push("COALESCE(ps.time, 0) > 30 * 60");
  else if (filters.time_range === "above_45") where.push("COALESCE(ps.time, 0) > 45 * 60");

  try {
    const topics = await getTopics();
    const result = await db.query(
      `SELECT ps.*, COALESCE(ap.title, 'Unmapped Problem') AS title,
              CASE WHEN ap.platform = 'neetcode250' THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url) ELSE ap.url END AS url,
              ap.difficulty AS problem_difficulty, COALESCE(ps.topic_id, ap.topic) AS topic_id, ap.platform AS problem_platform, t.name AS topic_name
       FROM problems_solved ps
       LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       LEFT JOIN topics t ON COALESCE(ps.topic_id, ap.topic) = t.id
       WHERE ${where.join(" AND ")}
       ORDER BY ps.created_at DESC`,
      values
    );

    res.render("filter_problems.ejs", { problems: result.rows, topics, filters });
  } catch (err) {
    console.error("Filter problems error:", err);
    res.status(500).send("Error filtering problems");
  }
});

router.post("/add", requireAuth, validateProblemSolveInput, attachProblemFromUrl, async (req, res) => {
  try {
    await applyTopicOverride(req);
    const solvedProblem = await saveSolvedProblem(req, req.problemLookup);
    updateDashboardCacheForSolvedProblem(req.session.userId, solvedProblem.dashboardCacheEvent);
    notifyFollowersProblemSolvedSoon(req.session.userId, solvedProblem.id);
    res.redirect("/dashboard");
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).send("Error adding problem");
  }
});

router.post("/add/manual", requireAuth, async (req, res) => {
  const validationResponse = validateManualProblemInput(req, res, renderManualProblemMetadata);
  if (validationResponse) return validationResponse;

  const { title, difficulty, topic, platform, slug, url } = req.body;
  const topicId = parseInt(topic, 10);
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const normalizedPlatform = normalizePlatform(platform);

  try {
    const extracted = extractProblemSlug(url);
    const problemSlug = slug || extracted?.slug || "";
    const storedUrl = problemUrlForStorage(normalizedPlatform, url, problemSlug);
    let problem = await findProblemInAllProblems(normalizedPlatform, problemSlug, url);

    if (!problem) {
      problem = await insertAllProblem({
        title: title.trim(),
        url: storedUrl,
        difficulty: normalizedDifficulty,
        topic: topicId,
        platform: normalizedPlatform,
      });
    }

    const solvedProblem = await saveSolvedProblem(req, { platform: normalizedPlatform, slug: problemSlug, problem });
    updateDashboardCacheForSolvedProblem(req.session.userId, solvedProblem.dashboardCacheEvent);
    notifyFollowersProblemSolvedSoon(req.session.userId, solvedProblem.id);
    res.redirect("/dashboard");
  } catch (error) {
    console.error("Manual problem add error:", error);
    res.status(500).send("Error adding manual problem metadata");
  }
});

router.get("/problems/:difficulty", requireAuth, async (req, res) => {
  const { difficulty } = req.params;
  let title = "";

  if (difficulty === "easy") title = "Easy Problems";
  else if (difficulty === "medium") title = "Medium Problems";
  else if (difficulty === "hard") title = "Hard Problems";
  else if (difficulty === "due") {
    try {
      const result = await db.query(
        `SELECT ps.*, COALESCE(ap.title, 'Unmapped Problem') AS title,
                CASE WHEN ap.platform = 'neetcode250' THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url) ELSE ap.url END AS url,
                ap.difficulty AS problem_difficulty, COALESCE(ps.topic_id, ap.topic) AS topic_id, t.name AS topic_name
         FROM problems_solved ps
         LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
         LEFT JOIN topics t ON COALESCE(ps.topic_id, ap.topic) = t.id
         WHERE ps.due_date <= NOW() AND (ps.status IS NULL OR ps.status != 'MASTERED') AND ps.user_id = $1
         ORDER BY ps.due_date ASC`,
        [req.session.userId]
      );
      const plannedProblems = await getOrCreateTodayRevisionPlan(req.session.userId, result.rows);
      const revisionLoad = await getUserRevisionLoad(req.session.userId);
      const topics = await getTopics();

      return res.render("problems.ejs", {
        problems: plannedProblems,
        title: "Today's Revision Problems",
        difficulty: "due",
        revisionLoad: Math.floor(revisionLoad),
        topics,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).send("Error fetching due problems");
    }
  } else {
    return res.status(404).send("Not found");
  }

  try {
    const topics = await getTopics();
    const result = await db.query(
      `SELECT ps.*, COALESCE(ap.title, 'Unmapped Problem') AS title,
              CASE WHEN ap.platform = 'neetcode250' THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url) ELSE ap.url END AS url,
              ap.difficulty AS problem_difficulty, COALESCE(ps.topic_id, ap.topic) AS topic_id, t.name AS topic_name
       FROM problems_solved ps
       LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       LEFT JOIN topics t ON COALESCE(ps.topic_id, ap.topic) = t.id
       WHERE ap.difficulty = $1 AND ps.user_id = $2
       ORDER BY ps.created_at DESC`,
      [title.replace(" Problems", ""), req.session.userId]
    );

    res.render("problems.ejs", { problems: result.rows, title, difficulty, topics });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching problems");
  }
});

router.get("/problems/:difficulty/:id/edit", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ps.*, COALESCE(ap.title, 'Unmapped Problem') AS title,
              CASE WHEN ap.platform = 'neetcode250'
                THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url)
                ELSE ap.url
              END AS url,
              ap.difficulty AS problem_difficulty,
              t.name AS topic_name
       FROM problems_solved ps
       LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       LEFT JOIN topics t ON COALESCE(ps.topic_id, ap.topic) = t.id
       WHERE ps.id = $1 AND ps.user_id = $2`,
      [req.params.id, req.session.userId]
    );

    if (result.rows.length === 0) return res.status(404).send("Problem not found");

    res.render("edit_problem.ejs", { problem: result.rows[0], difficulty: req.params.difficulty });
  } catch (err) {
    console.error("Edit problem form error:", err);
    res.status(500).send("Error loading problem editor");
  }
});

router.post("/problems/:difficulty/:id/update-info", requireAuth, async (req, res) => {
  const { code, mistake_made, hardest_part, hint_1, hint_2, hint_3 } = req.body;

  try {
    const result = await db.query(
      `UPDATE problems_solved
       SET code = $1,
           mistake_made = $2,
           hardest_part = $3,
           hint_1 = $4,
           hint_2 = $5,
           hint_3 = $6
       WHERE id = $7 AND user_id = $8`,
      [
        code?.trim() || null,
        mistake_made?.trim() || null,
        hardest_part?.trim() || null,
        hint_1?.trim() || null,
        hint_2?.trim() || null,
        hint_3?.trim() || null,
        req.params.id,
        req.session.userId,
      ]
    );

    if (result.rowCount === 0) return res.status(404).send("Problem not found");

    const returnPath = req.params.difficulty === "filter"
      ? "/problems/filter"
      : `/problems/${req.params.difficulty}`;

    res.redirect(returnPath);
  } catch (err) {
    console.error("Update problem info error:", err);
    res.status(500).send("Error updating problem info");
  }
});

router.post("/problems/:difficulty/:id/master", requireAuth, async (req, res) => {
  try {
    const previous = await db.query(
      "SELECT status, due_date FROM problems_solved WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    await db.query(
      "UPDATE problems_solved SET status = 'MASTERED' WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    await markTodayRevisionCompleted(req.session.userId, req.params.id);
    if (wasDueProblem(previous.rows[0])) updateDashboardDueProblems(req.session.userId, -1);
    res.redirect(`/problems/${req.params.difficulty}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating problem");
  }
});

router.post("/problems/:difficulty/:id/schedule", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ps.rating, ps.time, ps.status, ps.due_date, ap.difficulty, COALESCE(ps.topic_id, ap.topic) AS topic_id
       FROM problems_solved ps
       JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       WHERE ps.id = $1 AND ps.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).send("Problem not found");

    const problem = result.rows[0];
    const decayConstant = await getUserDecayConstant(req.session.userId, problem.topic_id);
    const baseStrength = calculateBaseStrength(problem.difficulty, problem.rating, problem.time);
    const currentThreshold = getInitialThreshold(problem.difficulty);
    const reviewDays = calculateReviewDays(baseStrength, currentThreshold, decayConstant);

    await db.query(
      `UPDATE problems_solved
       SET status = 'LEARNING', revisions_done = 0, base_strength = $1, current_threshold = $2,
           last_rev_date = NOW(), due_date = NOW() + INTERVAL '1 day' * ($3::INTEGER)
       WHERE id = $4 AND user_id = $5`,
      [baseStrength, currentThreshold, reviewDays, req.params.id, req.session.userId]
    );

    if (wasDueProblem(problem)) updateDashboardDueProblems(req.session.userId, -1);
    res.redirect(`/problems/${req.params.difficulty}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error scheduling problem");
  }
});

router.post("/problems/:difficulty/:id/revise", requireAuth, async (req, res) => {
  const rule = FEEDBACK_RULES[req.body.feedback];
  if (!rule) return res.status(400).send("Invalid revision feedback");

  try {
    const result = await db.query(
      `SELECT ps.base_strength, ps.current_threshold, ps.revisions_done, ps.status, ps.due_date, ap.difficulty,
              COALESCE(ps.topic_id, ap.topic) AS topic_id,
              uc.decay_constant
       FROM problems_solved ps
       JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       LEFT JOIN user_constants uc ON uc.user_id = ps.user_id AND uc.topic_id = COALESCE(ps.topic_id, ap.topic)
       WHERE ps.id = $1 AND ps.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).send("Problem not found");

    const problem = result.rows[0];
    const oldThreshold = parseFloat(problem.current_threshold || INITIAL_THRESHOLDS[problem.difficulty] || 90);
    const oldDecayConstant = parseFloat(problem.decay_constant || 0.03);
    const newThreshold = oldThreshold * rule.thresholdMultiplier;
    const newDecayConstant = clamp(oldDecayConstant * rule.decayMultiplier, 0.015, 0.075);
    const newRevisionCount = (parseInt(problem.revisions_done, 10) || 0) + 1;
    const maxRevisions = MAX_REVISIONS[problem.difficulty] || 5;
    const nextStatus = newRevisionCount >= maxRevisions ? "MASTERED" : "LEARNING";
    const reviewDays = nextStatus === "MASTERED"
      ? 0
      : calculateReviewDays(problem.base_strength, newThreshold, newDecayConstant);

    const constantUpdate = await db.query(
      `UPDATE user_constants SET decay_constant = $1 WHERE user_id = $2 AND topic_id = $3`,
      [newDecayConstant, req.session.userId, problem.topic_id]
    );
    if (constantUpdate.rowCount === 0) {
      await db.query(
        `INSERT INTO user_constants (user_id, topic_id, decay_constant) VALUES ($1, $2, $3)`,
        [req.session.userId, problem.topic_id, newDecayConstant]
      );
    }

    await db.query(
      `UPDATE problems_solved
       SET status = $1, revisions_done = $2, current_threshold = $3, last_rev_date = NOW(),
           due_date = NOW() + INTERVAL '1 day' * ($4::INTEGER)
       WHERE id = $5 AND user_id = $6`,
      [nextStatus, newRevisionCount, newThreshold, reviewDays, req.params.id, req.session.userId]
    );
    await markTodayRevisionCompleted(req.session.userId, req.params.id);
    if (wasDueProblem(problem)) updateDashboardDueProblems(req.session.userId, -1);
    res.redirect(`/problems/${req.params.difficulty}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error revising problem");
  }
});

router.post("/problems/:difficulty/:id/update-approach", requireAuth, async (req, res) => {
  try {
    await db.query(
      "UPDATE problems_solved SET code = $1 WHERE id = $2 AND user_id = $3",
      [req.body.code, req.params.id, req.session.userId]
    );
    res.redirect(`/problems/${req.params.difficulty}`);
  } catch (err) {
    console.error("Error updating approach:", err);
    res.status(500).send("Error updating approach");
  }
});

router.get("/problems/:difficulty/random", requireAuth, async (req, res) => {
  const { difficulty } = req.params;
  let query = "";
  let params = [req.session.userId];
  const urlCase = `CASE WHEN ap.platform = 'neetcode250' THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url) ELSE ap.url END AS url`;

  if (["easy", "medium", "hard"].includes(difficulty)) {
    const diff = difficulty[0].toUpperCase() + difficulty.slice(1);
    query = `SELECT ${urlCase}
             FROM problems_solved ps JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
             WHERE ap.difficulty = $2 AND ps.user_id = $1 ORDER BY RANDOM() LIMIT 1`;
    params.push(diff);
  } else if (difficulty === "due") {
    query = `SELECT ${urlCase}
             FROM problems_solved ps
             JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
             JOIN revision_daily_plans rdp ON rdp.problem_solved_id = ps.id
             WHERE ps.due_date <= NOW() AND (ps.status IS NULL OR ps.status != 'MASTERED')
               AND ps.user_id = $1 AND rdp.user_id = $1 AND rdp.plan_date = CURRENT_DATE
             ORDER BY RANDOM() LIMIT 1`;
  } else {
    return res.status(404).send("Not found");
  }

  try {
    const result = await db.query(query, params);
    if (result.rows.length > 0) res.redirect(result.rows[0].url);
    else res.redirect(`/problems/${difficulty}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching random problem");
  }
});

export default router;
