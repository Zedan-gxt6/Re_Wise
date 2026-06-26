import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import session from "express-session";
import pgSession from "connect-pg-simple";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIFFICULTY_BASE_STRENGTH = { Easy: 100, Medium: 120, Hard: 140 };
const INITIAL_THRESHOLDS = { Easy: 70, Medium: 90, Hard: 110 };
const EXPECTED_TIME_MINUTES = { Easy: 10, Medium: 25, Hard: 40 };
const FEEDBACK_RULES = {
  remembered: { thresholdMultiplier: 0.85, decayMultiplier: 0.96 },
  partial: { thresholdMultiplier: 1.05, decayMultiplier: 1.03 },
  forgot: { thresholdMultiplier: 1.20, decayMultiplier: 1.08 },
};
const MAX_REVISIONS = { Easy: 3, Medium: 5, Hard: 7 };
const LEETCODE_TOPIC_MAP = {
  array: 1, "hash-table": 1, string: 1, "two-pointers": 2, "sliding-window": 3,
  "binary-search": 4, "linked-list": 5, tree: 6, "binary-tree": 6,
  "binary-search-tree": 6, stack: 7, heap: 7, "priority-queue": 7, queue: 7,
  "monotonic-stack": 7, backtracking: 8, recursion: 8, graph: 9, "union-find": 9,
  "topological-sort": 9, "shortest-path": 9, "depth-first-search": 9,
  "breadth-first-search": 9, "dynamic-programming": 10, greedy: 11, sorting: 11,
  "merge-sort": 11, interval: 11, math: 12, geometry: 12, "bit-manipulation": 13,
  trie: 13,
};

const app = express();
const port = 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY");
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const db = new pg.Pool({
  user: "postgres",
  host: "localhost",
  database: "dsa_tracker",
  password: process.env.DB_PASSWORD,
  port: 5432,
});
db.connect();

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function extractProblemSlug(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (host === "neetcode.io" && parts[0] === "problems" && parts[1]) {
      return { platform: "neetcode250", slug: parts[1] };
    }
    if (host === "leetcode.com" && parts[0] === "problems" && parts[1]) {
      return { platform: "leetcode", slug: parts[1] };
    }

    const fallbackPlatform = host.includes("geeksforgeeks.org")
      ? "gfg"
      : host.split(".")[0] || "other";
    return { platform: fallbackPlatform, slug: parts[parts.length - 1] || "", unsupported: true };
  } catch {
    return null;
  }
}

function normalizeDifficulty(difficulty) {
  const value = String(difficulty || "").toLowerCase();
  if (value === "easy") return "Easy";
  if (value === "medium") return "Medium";
  if (value === "hard") return "Hard";
  return null;
}

function normalizePlatform(platform) {
  const value = String(platform || "").trim().toLowerCase();
  if (value === "neetcode" || value === "neetcode250") return "neetcode250";
  if (value === "leetcode") return "leetcode";
  return value || "other";
}

function problemUrlForStorage(platform, url, slug) {
  if (platform === "neetcode250") return slug || url;
  if (platform === "leetcode" && slug) return `https://leetcode.com/problems/${slug}/`;
  return url;
}

function getInitialThreshold(difficulty) {
  return INITIAL_THRESHOLDS[difficulty] || 90;
}

function calculateBaseStrength(difficulty, independence, timeSeconds) {
  let memoryStrength = DIFFICULTY_BASE_STRENGTH[difficulty] || 120;
  const independenceScore = parseInt(independence, 10);
  if (independenceScore === 1) memoryStrength += 15;
  else if (independenceScore === 2) memoryStrength -= 10;
  else if (independenceScore === 3) memoryStrength -= 30;

  const expectedMinutes = EXPECTED_TIME_MINUTES[difficulty] || 25;
  const actualMinutes = Math.round((parseInt(timeSeconds, 10) || 0) / 60);
  const timeModifier = clamp(expectedMinutes - actualMinutes, -30, 30);
  return memoryStrength + timeModifier;
}

function getTimeForScoring(problem, submittedTime, ignoreTime) {
  if (ignoreTime === "on") {
    return (EXPECTED_TIME_MINUTES[problem.difficulty] || 25) * 60;
  }
  return parseInt(submittedTime, 10);
}

function calculateReviewDays(baseStrength, currentThreshold, decayConstant) {
  if (!baseStrength || !currentThreshold || !decayConstant || baseStrength <= currentThreshold) return 1;
  return Math.max(1, Math.ceil(Math.log(baseStrength / currentThreshold) / decayConstant));
}

function calculateDaysSinceDue(dueDate) {
  if (!dueDate) return 0;
  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = now.setHours(0, 0, 0, 0) - due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function calculateRevisionPriority(problem) {
  const daysSinceDue = calculateDaysSinceDue(problem.due_date);
  const actualMinutes = Math.round((parseInt(problem.time, 10) || 0) / 60);
  const expectedMinutes = EXPECTED_TIME_MINUTES[problem.problem_difficulty] || 25;
  const timeScore = clamp((actualMinutes - expectedMinutes) * 2, -10, 40);
  const independence = parseInt(problem.rating, 10);
  const independenceScore = independence === 2 ? 25 : independence === 3 ? 40 : 0;
  const daysDueScore = daysSinceDue * 10;
  return {
    ...problem,
    days_since_due: daysSinceDue,
    days_due_score: daysDueScore,
    time_priority_score: timeScore,
    independence_priority_score: independenceScore,
    priority_score: daysDueScore + timeScore + independenceScore,
    is_emergency_due: daysSinceDue >= 7,
  };
}

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

function arrangeDueProblems(problems, revisionLoad = 4) {
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

function calculateConceptPriority(concept) {
  const daysSinceDue = calculateDaysSinceDue(concept.due_date);
  const importance = clamp(parseInt(concept.priority, 10) || 3, 1, 5);
  return { ...concept, days_since_due: daysSinceDue, concept_priority_score: importance * 2 + daysSinceDue * 2 };
}

function arrangeDueConcepts(concepts, conceptLoad = 5) {
  return concepts
    .map(calculateConceptPriority)
    .sort((a, b) => b.concept_priority_score - a.concept_priority_score || b.days_since_due - a.days_since_due)
    .slice(0, Math.floor(conceptLoad));
}

async function getTopics() {
  const result = await db.query("SELECT id, name FROM topics ORDER BY id");
  return result.rows;
}

async function getUserDecayConstant(userId, topicId) {
  const result = await db.query(
    `SELECT decay_constant FROM user_constants WHERE user_id = $1 AND topic_id = $2 LIMIT 1`,
    [userId, topicId]
  );
  if (result.rows.length > 0) return parseFloat(result.rows[0].decay_constant);

  const fallback = await db.query("SELECT decay_constant FROM topics WHERE id = $1", [topicId]);
  const decayConstant = parseFloat(fallback.rows[0]?.decay_constant || 0.03);
  await db.query(
    `INSERT INTO user_constants (user_id, topic_id, decay_constant) VALUES ($1, $2, $3)`,
    [userId, topicId, decayConstant]
  );
  return decayConstant;
}

async function seedUserConstants(userId) {
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

async function getUserRevisionLoad(userId) {
  const result = await db.query("SELECT revision_load FROM users WHERE id = $1", [userId]);
  const revisionLoad = parseFloat(result.rows[0]?.revision_load || 4);
  const clampedLoad = clamp(revisionLoad, 2, 8);
  if (clampedLoad !== revisionLoad) await db.query("UPDATE users SET revision_load = $1 WHERE id = $2", [clampedLoad, userId]);
  return clampedLoad;
}

async function adjustPastRevisionLoads(userId) {
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
    await db.query(`UPDATE revision_daily_plans SET load_adjusted = TRUE WHERE user_id = $1 AND plan_date = $2`, [userId, plan.plan_date]);
  }
}

async function getOrCreateTodayRevisionPlan(userId, dueProblems) {
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

async function markTodayRevisionCompleted(userId, problemSolvedId) {
  await db.query(
    `UPDATE revision_daily_plans
     SET completed_at = COALESCE(completed_at, NOW())
     WHERE user_id = $1 AND problem_solved_id = $2 AND plan_date = CURRENT_DATE`,
    [userId, problemSolvedId]
  );
}

async function getUserConceptLoad(userId) {
  const result = await db.query("SELECT concept_revision_load FROM users WHERE id = $1", [userId]);
  const conceptLoad = parseFloat(result.rows[0]?.concept_revision_load || 5);
  const clampedLoad = clamp(conceptLoad, 2, 10);
  if (clampedLoad !== conceptLoad) await db.query("UPDATE users SET concept_revision_load = $1 WHERE id = $2", [clampedLoad, userId]);
  return clampedLoad;
}

async function adjustPastConceptLoads(userId) {
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
    await db.query(`UPDATE concept_daily_plans SET load_adjusted = TRUE WHERE user_id = $1 AND plan_date = $2`, [userId, plan.plan_date]);
  }
}

async function getOrCreateTodayConceptPlan(userId, dueConcepts) {
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

async function markTodayConceptCompleted(userId, conceptId) {
  await db.query(
    `UPDATE concept_daily_plans
     SET completed_at = COALESCE(completed_at, NOW())
     WHERE user_id = $1 AND concept_id = $2 AND plan_date = CURRENT_DATE`,
    [userId, conceptId]
  );
}

async function getConceptBooks(userId) {
  const result = await db.query("SELECT id, name FROM concept_books WHERE user_id = $1 ORDER BY name ASC", [userId]);
  return result.rows;
}

async function resolveConceptBook(userId, existingBookId, newBookName) {
  const trimmedName = newBookName?.trim();
  if (trimmedName) {
    const result = await db.query(
      `INSERT INTO concept_books (user_id, name)
       VALUES ($1, $2)
       ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [userId, trimmedName]
    );
    return result.rows[0].id;
  }

  const parsedBookId = parseInt(existingBookId, 10);
  if (!Number.isInteger(parsedBookId)) return null;
  const result = await db.query("SELECT id FROM concept_books WHERE id = $1 AND user_id = $2", [parsedBookId, userId]);
  return result.rows[0]?.id || null;
}

function mapLeetcodeTopic(topicTags = []) {
  for (const tag of topicTags) {
    const topicId = LEETCODE_TOPIC_MAP[tag.slug];
    if (topicId) return topicId;
  }
  return null;
}

async function findProblemInAllProblems(platform, slug, url) {
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

async function fetchLeetcodeMetadata(slug) {
  const response = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: `https://leetcode.com/problems/${slug}/` },
    body: JSON.stringify({
      query: `query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { title titleSlug difficulty topicTags { name slug } } }`,
      variables: { titleSlug: slug },
    }),
  });
  if (!response.ok) throw new Error(`LeetCode GraphQL failed with ${response.status}`);
  const payload = await response.json();
  const question = payload.data?.question;
  if (!question) throw new Error("LeetCode problem was not found");
  return question;
}

async function insertAllProblem({ title, url, difficulty, topic, platform }) {
  const result = await db.query(
    `INSERT INTO all_problems (title, url, difficulty, topic, platform)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, url, difficulty, topic, platform`,
    [title, url, difficulty, topic, platform]
  );
  return result.rows[0];
}

async function renderManualProblemMetadata(req, res, reason, metadata = {}) {
  const topics = await getTopics();
  const extracted = extractProblemSlug(req.body.url);
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
    },
    metadata: {
      platform: metadata.platform || extracted?.platform || "other",
      slug: metadata.slug || extracted?.slug || "",
      title: metadata.title || "",
      difficulty: normalizeDifficulty(metadata.difficulty) || "",
      topic: metadata.topic || "",
    },
  });
}

function validateProblemSolveInput(req, res, next) {
  const { rating, time, code, action, ignore_time } = req.body;
  const parsedTime = parseInt(time, 10);
  if (!req.body.url) return res.status(400).send("Please enter the problem URL");
  if (!["1", "2", "3"].includes(rating)) return res.status(400).send("Please select how independently you solved the problem");
  if (ignore_time !== "on" && (!Number.isInteger(parsedTime) || parsedTime <= 0)) {
    return res.status(400).send("Please record the time taken before adding the problem");
  }
  if (!code || code.trim().length === 0) return res.status(400).send("Please add your code approach");
  if (!["schedule", "mastered"].includes(action)) return res.status(400).send("Please choose whether to schedule or fix the problem");
  next();
}

async function saveSolvedProblem(req, problemLookup) {
  const { rating, time, code, action, ignore_time } = req.body;
  const problem = problemLookup.problem;
  const status = action === "mastered" ? "MASTERED" : "LEARNING";
  const parsedTime = getTimeForScoring(problem, time, ignore_time);
  const decayConstant = await getUserDecayConstant(req.session.userId, problem.topic);
  const baseStrength = calculateBaseStrength(problem.difficulty, rating, parsedTime);
  const currentThreshold = getInitialThreshold(problem.difficulty);
  const reviewDays = status === "MASTERED" ? 0 : calculateReviewDays(baseStrength, currentThreshold, decayConstant);

  await db.query(
    `INSERT INTO problems_solved
       (prob_id, rating, time, code, base_strength, current_threshold, last_rev_date, due_date, status, user_id, platform)
     VALUES
       ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 day' * ($7::INTEGER), $8, $9, $10)`,
    [problem.id, rating, parsedTime, code.trim(), baseStrength, currentThreshold, reviewDays, status, req.session.userId, problemLookup.platform]
  );
}

async function attachProblemFromUrl(req, res, next) {
  const extracted = extractProblemSlug(req.body.url);
  if (!extracted) {
    return renderManualProblemMetadata(req, res, "I could not read this URL automatically. Add the metadata manually once and I will store it.");
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
          return renderManualProblemMetadata(req, res, "LeetCode metadata was found, but I could not confidently map its topic.", {
            platform, slug: metadata.titleSlug, title: metadata.title, difficulty: metadata.difficulty,
          });
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
        return renderManualProblemMetadata(req, res, "LeetCode API lookup failed, so add the metadata manually.", { platform, slug: extracted.slug });
      }
    }

    const reason = platform === "neetcode250"
      ? "This NeetCode problem is not in your NeetCode 250 list. Add metadata manually if you still want to track it."
      : "This platform is not supported automatically yet. Add the metadata manually once and I will track it.";
    return renderManualProblemMetadata(req, res, reason, { platform, slug: extracted.slug });
  } catch (error) {
    console.error("Problem lookup error:", error);
    return renderManualProblemMetadata(req, res, "Something failed during automatic lookup. Add metadata manually and I will continue.", {
      platform: extracted.platform, slug: extracted.slug,
    });
  }
}

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(session({
  store: new (pgSession(session))({ pool: db, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (req.method === "GET") return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    return res.status(401).send("Session expired. Please login again.");
  }
  next();
}

app.get("/", (req, res) => {
  if (req.session?.userId) return res.redirect("/dashboard");
  return res.redirect("/login");
});

app.get("/api/session", (req, res) => {
  res.json({ authenticated: Boolean(req.session?.userId) });
});

app.post("/api/signup", async (req, res) => {
  const { username, password, skill_level, prep_duration } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const prepMonths = prep_duration ? parseInt(prep_duration, 10) : null;
    const result = await db.query(
      `INSERT INTO users (username, password_hashed, "prepDuration", skill_level)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [username, hashed, prepMonths, skill_level]
    );
    const userId = result.rows[0].id;
    await seedUserConstants(userId);
    req.session.userId = userId;
    res.json({ message: "Signup successful" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await db.query("SELECT id, password_hashed FROM users WHERE username=$1", [username]);
    if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(password, rows[0].password_hashed);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    req.session.userId = rows[0].id;
    res.json({ message: "Login successful" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login error" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out" });
  });
});

app.get("/login", (req, res) => res.render("login.ejs"));
app.get("/signup", (req, res) => res.render("signup.ejs"));

app.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const totalRes = await db.query("SELECT COUNT(*) FROM problems_solved WHERE user_id = $1", [userId]);
    const todayRes = await db.query("SELECT COUNT(*) FROM problems_solved WHERE user_id = $1 AND created_at >= CURRENT_DATE", [userId]);
    res.render("index.ejs", {
      totalSolved: parseInt(totalRes.rows[0].count, 10),
      todaySolved: parseInt(todayRes.rows[0].count, 10),
    });
  } catch (err) {
    console.error("Dashboard statistics query error:", err);
    res.status(500).send("Error loading dashboard");
  }
});

app.get("/new", requireAuth, (req, res) => res.render("new.ejs"));

app.get("/problems/filter", requireAuth, async (req, res) => {
  const filters = {
    topic: req.query.topic || "", time_range: req.query.time_range || "",
    independence: req.query.independence || "", difficulty: req.query.difficulty || "",
    status: req.query.status || "", platform: req.query.platform || "",
  };
  const where = ["ps.user_id = $1"];
  const values = [req.session.userId];
  if (filters.topic) { values.push(parseInt(filters.topic, 10)); where.push(`ap.topic = $${values.length}`); }
  if (filters.independence) { values.push(parseInt(filters.independence, 10)); where.push(`ps.rating = $${values.length}`); }
  if (["Easy", "Medium", "Hard"].includes(filters.difficulty)) { values.push(filters.difficulty); where.push(`ap.difficulty = $${values.length}`); }
  if (filters.status) { values.push(filters.status); where.push(`COALESCE(ps.status, 'LEARNING') = $${values.length}`); }
  if (filters.platform) { values.push(filters.platform); where.push(`ps.platform = $${values.length}`); }
  if (filters.time_range === "below_15") where.push("COALESCE(ps.time, 0) < 15 * 60");
  else if (filters.time_range === "15_30") where.push("COALESCE(ps.time, 0) >= 15 * 60 AND COALESCE(ps.time, 0) <= 30 * 60");
  else if (filters.time_range === "above_30") where.push("COALESCE(ps.time, 0) > 30 * 60");
  else if (filters.time_range === "above_45") where.push("COALESCE(ps.time, 0) > 45 * 60");

  try {
    const topics = await getTopics();
    const result = await db.query(
      `SELECT ps.*, COALESCE(ap.title, 'Unmapped Problem') AS title,
              CASE WHEN ap.platform = 'neetcode250' THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url) ELSE ap.url END AS url,
              ap.difficulty AS problem_difficulty, ap.platform AS problem_platform, t.name AS topic_name
       FROM problems_solved ps
       LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       LEFT JOIN topics t ON ap.topic = t.id
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

app.post("/add", requireAuth, validateProblemSolveInput, attachProblemFromUrl, async (req, res) => {
  try {
    await saveSolvedProblem(req, req.problemLookup);
    res.redirect("/");
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).send("Error adding problem");
  }
});

app.post("/add/manual", requireAuth, async (req, res) => {
  const { title, difficulty, topic, platform, slug, url, rating, time, code, action, ignore_time } = req.body;
  const parsedTime = parseInt(time, 10);
  const topicId = parseInt(topic, 10);
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const normalizedPlatform = normalizePlatform(platform);
  if (!title?.trim()) return renderManualProblemMetadata(req, res, "Please enter the exact problem title.", req.body);
  if (!normalizedDifficulty) return renderManualProblemMetadata(req, res, "Please select the platform difficulty.", req.body);
  if (!Number.isInteger(topicId)) return renderManualProblemMetadata(req, res, "Please select the topic bucket.", req.body);
  if (!["1", "2", "3"].includes(rating)) return renderManualProblemMetadata(req, res, "Please select how independently you solved it.", req.body);
  if (ignore_time !== "on" && (!Number.isInteger(parsedTime) || parsedTime <= 0)) {
    return renderManualProblemMetadata(req, res, "Please record the time taken before adding the problem.", req.body);
  }
  if (!code?.trim()) return renderManualProblemMetadata(req, res, "Please add your code approach.", req.body);
  if (!["schedule", "mastered"].includes(action)) return renderManualProblemMetadata(req, res, "Please choose whether to schedule or fix the problem.", req.body);

  try {
    const extracted = extractProblemSlug(url);
    const problemSlug = slug || extracted?.slug || "";
    const storedUrl = problemUrlForStorage(normalizedPlatform, url, problemSlug);
    let problem = await findProblemInAllProblems(normalizedPlatform, problemSlug, url);
    if (!problem) {
      problem = await insertAllProblem({ title: title.trim(), url: storedUrl, difficulty: normalizedDifficulty, topic: topicId, platform: normalizedPlatform });
    }
    await saveSolvedProblem(req, { platform: normalizedPlatform, slug: problemSlug, problem });
    res.redirect("/");
  } catch (error) {
    console.error("Manual problem add error:", error);
    res.status(500).send("Error adding manual problem metadata");
  }
});

app.get("/problems/:difficulty", requireAuth, async (req, res) => {
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
                ap.difficulty AS problem_difficulty, ap.topic AS topic_id, t.name AS topic_name
         FROM problems_solved ps
         LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
         LEFT JOIN topics t ON ap.topic = t.id
         WHERE ps.due_date <= NOW() AND (ps.status IS NULL OR ps.status != 'MASTERED') AND ps.user_id = $1
         ORDER BY ps.due_date ASC`,
        [req.session.userId]
      );
      const plannedProblems = await getOrCreateTodayRevisionPlan(req.session.userId, result.rows);
      const revisionLoad = await getUserRevisionLoad(req.session.userId);
      return res.render("problems.ejs", { problems: plannedProblems, title: "Today's Revision Problems", difficulty: "due", revisionLoad: Math.floor(revisionLoad) });
    } catch (err) {
      console.error(err);
      return res.status(500).send("Error fetching due problems");
    }
  } else return res.status(404).send("Not found");

  try {
    const result = await db.query(
      `SELECT ps.*, COALESCE(ap.title, 'Unmapped Problem') AS title,
              CASE WHEN ap.platform = 'neetcode250' THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url) ELSE ap.url END AS url,
              ap.difficulty AS problem_difficulty, ap.topic AS topic_id, t.name AS topic_name
       FROM problems_solved ps
       LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       LEFT JOIN topics t ON ap.topic = t.id
       WHERE ap.difficulty = $1 AND ps.user_id = $2
       ORDER BY ps.created_at DESC`,
      [title.replace(" Problems", ""), req.session.userId]
    );
    res.render("problems.ejs", { problems: result.rows, title, difficulty });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching problems");
  }
});

app.post("/problems/:difficulty/:id/master", requireAuth, async (req, res) => {
  try {
    await db.query("UPDATE problems_solved SET status = 'MASTERED' WHERE id = $1 AND user_id = $2", [req.params.id, req.session.userId]);
    await markTodayRevisionCompleted(req.session.userId, req.params.id);
    res.redirect(`/problems/${req.params.difficulty}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating problem");
  }
});

app.post("/problems/:difficulty/:id/schedule", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ps.rating, ps.time, ap.difficulty, ap.topic
       FROM problems_solved ps
       JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       WHERE ps.id = $1 AND ps.user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).send("Problem not found");
    const problem = result.rows[0];
    const decayConstant = await getUserDecayConstant(req.session.userId, problem.topic);
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
    res.redirect(`/problems/${req.params.difficulty}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error scheduling problem");
  }
});

app.post("/problems/:difficulty/:id/revise", requireAuth, async (req, res) => {
  const rule = FEEDBACK_RULES[req.body.feedback];
  if (!rule) return res.status(400).send("Invalid revision feedback");
  try {
    const result = await db.query(
      `SELECT ps.base_strength, ps.current_threshold, ps.revisions_done, ap.difficulty, ap.topic, uc.decay_constant
       FROM problems_solved ps
       JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       LEFT JOIN user_constants uc ON uc.user_id = ps.user_id AND uc.topic_id = ap.topic
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
    const reviewDays = nextStatus === "MASTERED" ? 0 : calculateReviewDays(problem.base_strength, newThreshold, newDecayConstant);

    const constantUpdate = await db.query(
      `UPDATE user_constants SET decay_constant = $1 WHERE user_id = $2 AND topic_id = $3`,
      [newDecayConstant, req.session.userId, problem.topic]
    );
    if (constantUpdate.rowCount === 0) {
      await db.query(`INSERT INTO user_constants (user_id, topic_id, decay_constant) VALUES ($1, $2, $3)`, [req.session.userId, problem.topic, newDecayConstant]);
    }
    await db.query(
      `UPDATE problems_solved
       SET status = $1, revisions_done = $2, current_threshold = $3, last_rev_date = NOW(),
           due_date = NOW() + INTERVAL '1 day' * ($4::INTEGER)
       WHERE id = $5 AND user_id = $6`,
      [nextStatus, newRevisionCount, newThreshold, reviewDays, req.params.id, req.session.userId]
    );
    await markTodayRevisionCompleted(req.session.userId, req.params.id);
    res.redirect(`/problems/${req.params.difficulty}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error revising problem");
  }
});

app.post("/problems/:difficulty/:id/update-approach", requireAuth, async (req, res) => {
  try {
    await db.query("UPDATE problems_solved SET code = $1 WHERE id = $2 AND user_id = $3", [req.body.code, req.params.id, req.session.userId]);
    res.redirect(`/problems/${req.params.difficulty}`);
  } catch (err) {
    console.error("Error updating approach:", err);
    res.status(500).send("Error updating approach");
  }
});

app.get("/problems/:difficulty/random", requireAuth, async (req, res) => {
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
  } else return res.status(404).send("Not found");
  try {
    const result = await db.query(query, params);
    if (result.rows.length > 0) res.redirect(result.rows[0].url);
    else res.redirect(`/problems/${difficulty}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching random problem");
  }
});

app.get("/concepts/new", requireAuth, async (req, res) => {
  try {
    const books = await getConceptBooks(req.session.userId);
    res.render("new_concept.ejs", { books });
  } catch (e) {
    console.error("New concept form error:", e);
    res.status(500).send("Error loading concept form");
  }
});

app.post("/add_concept", requireAuth, async (req, res) => {
  const { title, concept, review_days, book_id, new_book_name, priority } = req.body;
  const days = parseInt(review_days, 10) || 1;
  const conceptPriority = clamp(parseInt(priority, 10) || 3, 1, 5);
  try {
    const resolvedBookId = await resolveConceptBook(req.session.userId, book_id, new_book_name);
    await db.query(
      `INSERT INTO concepts (title, concept, userid, due_date, review_days, book_id, priority)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 day' * ($4::INTEGER), $4, $5, $6)`,
      [title, concept, req.session.userId, days, resolvedBookId, conceptPriority]
    );
    res.redirect("/concepts");
  } catch (e) {
    console.error("Add concept error:", e);
    res.status(500).send("Error adding concept");
  }
});

app.get("/concepts", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, cb.name AS book_name
       FROM concepts c LEFT JOIN concept_books cb ON c.book_id = cb.id
       WHERE c.due_date <= NOW() AND (c.status IS NULL OR c.status != 'MASTERED') AND c.userid = $1
       ORDER BY c.due_date ASC`,
      [req.session.userId]
    );
    const concepts = await getOrCreateTodayConceptPlan(req.session.userId, result.rows);
    res.render("concepts.ejs", { concepts });
  } catch (e) {
    console.error("Fetch due concepts error:", e);
    res.status(500).send("Error loading concepts");
  }
});

app.get("/concepts/all", requireAuth, async (req, res) => {
  const selectedBook = req.query.book || "";
  const values = [req.session.userId];
  const where = ["c.userid = $1"];
  if (selectedBook) {
    values.push(parseInt(selectedBook, 10));
    where.push(`c.book_id = $${values.length}`);
  }
  try {
    const books = await getConceptBooks(req.session.userId);
    const result = await db.query(
      `SELECT c.*, cb.name AS book_name
       FROM concepts c LEFT JOIN concept_books cb ON c.book_id = cb.id
       WHERE ${where.join(" AND ")}
       ORDER BY c.created_at DESC`,
      values
    );
    res.render("all_concepts.ejs", { concepts: result.rows, books, selectedBook });
  } catch (e) {
    console.error("All concepts error:", e);
    res.status(500).send("Error loading all concepts");
  }
});

app.get("/concepts/:id/edit", requireAuth, async (req, res) => {
  try {
    const books = await getConceptBooks(req.session.userId);
    const result = await db.query("SELECT * FROM concepts WHERE id = $1 AND userid = $2", [req.params.id, req.session.userId]);
    if (result.rows.length === 0) return res.status(404).send("Concept not found");
    res.render("edit_concept.ejs", { concept: result.rows[0], books });
  } catch (e) {
    console.error("Edit concept form error:", e);
    res.status(500).send("Error loading concept editor");
  }
});

app.post("/concepts/:id/update", requireAuth, async (req, res) => {
  const { title, concept, review_days, book_id, new_book_name, priority } = req.body;
  const days = parseInt(review_days, 10) || 1;
  const conceptPriority = clamp(parseInt(priority, 10) || 3, 1, 5);
  if (!title?.trim() || !concept?.trim()) return res.status(400).send("Title and concept are required");
  try {
    const resolvedBookId = await resolveConceptBook(req.session.userId, book_id, new_book_name);
    const result = await db.query(
      `UPDATE concepts
       SET title = $1, concept = $2, review_days = $3, book_id = $4, priority = $5
       WHERE id = $6 AND userid = $7`,
      [title.trim(), concept.trim(), days, resolvedBookId, conceptPriority, req.params.id, req.session.userId]
    );
    if (result.rowCount === 0) return res.status(404).send("Concept not found");
    res.redirect("/concepts/all");
  } catch (e) {
    console.error("Update concept error:", e);
    res.status(500).send("Error updating concept");
  }
});

app.post("/concepts/:id/master", requireAuth, async (req, res) => {
  try {
    const result = await db.query("UPDATE concepts SET status = 'MASTERED' WHERE id = $1 AND userid = $2", [req.params.id, req.session.userId]);
    if (result.rowCount === 0) return res.status(404).send("Concept not found");
    await markTodayConceptCompleted(req.session.userId, req.params.id);
    res.redirect("/concepts");
  } catch (e) {
    console.error("Master concept error:", e);
    res.status(500).send("Error mastering concept");
  }
});

app.post("/concepts/:id/rotate", requireAuth, async (req, res) => {
  const days = parseInt(req.body.review_days, 10) || 1;
  try {
    const result = await db.query(
      `UPDATE concepts
       SET status = 'LEARNING', review_days = $1, due_date = NOW() + INTERVAL '1 day' * ($1::INTEGER)
       WHERE id = $2 AND userid = $3`,
      [days, req.params.id, req.session.userId]
    );
    if (result.rowCount === 0) return res.status(404).send("Concept not found");
    await markTodayConceptCompleted(req.session.userId, req.params.id);
    res.redirect("/concepts");
  } catch (e) {
    console.error("Rotate concept error:", e);
    res.status(500).send("Error rotating concept");
  }
});

app.listen(port, () => {
  console.log(`Server up and running on http://localhost:${port}`);
});
