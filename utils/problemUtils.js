export const DIFFICULTY_BASE_STRENGTH = { Easy: 100, Medium: 120, Hard: 140 };
export const INITIAL_THRESHOLDS = { Easy: 70, Medium: 90, Hard: 110 };
export const EXPECTED_TIME_MINUTES = { Easy: 10, Medium: 25, Hard: 40 };
export const FEEDBACK_RULES = {
  remembered: { thresholdMultiplier: 0.85, decayMultiplier: 0.96 },
  partial: { thresholdMultiplier: 1.05, decayMultiplier: 1.03 },
  forgot: { thresholdMultiplier: 1.20, decayMultiplier: 1.08 },
};
export const MAX_REVISIONS = { Easy: 3, Medium: 5, Hard: 7 };

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

const LEETCODE_TOPIC_PRIORITY = [
  "dynamic-programming",
  "monotonic-stack",
  "stack",
  "heap",
  "priority-queue",
  "graph",
  "union-find",
  "topological-sort",
  "shortest-path",
  "depth-first-search",
  "breadth-first-search",
  "tree",
  "binary-tree",
  "binary-search-tree",
  "trie",
  "backtracking",
  "recursion",
  "binary-search",
  "sliding-window",
  "two-pointers",
  "greedy",
  "interval",
  "bit-manipulation",
  "math",
  "geometry",
  "sorting",
  "hash-table",
  "array",
  "string",
];

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function extractProblemSlug(url) {
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

export function normalizeDifficulty(difficulty) {
  const value = String(difficulty || "").toLowerCase();
  if (value === "easy") return "Easy";
  if (value === "medium") return "Medium";
  if (value === "hard") return "Hard";
  return null;
}

export function normalizePlatform(platform) {
  const value = String(platform || "").trim().toLowerCase();
  if (value === "neetcode" || value === "neetcode250") return "neetcode250";
  if (value === "leetcode") return "leetcode";
  return value || "other";
}

export function problemUrlForStorage(platform, url, slug) {
  if (platform === "neetcode250") return slug || url;
  if (platform === "leetcode" && slug) return `https://leetcode.com/problems/${slug}/`;
  return url;
}

export function getInitialThreshold(difficulty) {
  return INITIAL_THRESHOLDS[difficulty] || 90;
}

export function calculateBaseStrength(difficulty, independence, timeSeconds) {
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

export function getTimeForScoring(problem, submittedTime, ignoreTime) {
  if (ignoreTime === "on") {
    return (EXPECTED_TIME_MINUTES[problem.difficulty] || 25) * 60;
  }

  return parseInt(submittedTime, 10);
}

export function calculateReviewDays(baseStrength, currentThreshold, decayConstant) {
  if (!baseStrength || !currentThreshold || !decayConstant || baseStrength <= currentThreshold) return 1;
  return Math.max(1, Math.ceil(Math.log(baseStrength / currentThreshold) / decayConstant));
}

export function calculateDaysSinceDue(dueDate) {
  if (!dueDate) return 0;

  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = now.setHours(0, 0, 0, 0) - due.setHours(0, 0, 0, 0);

  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function calculateRevisionPriority(problem) {
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

export function calculateConceptPriority(concept) {
  const daysSinceDue = calculateDaysSinceDue(concept.due_date);
  const importance = clamp(parseInt(concept.priority, 10) || 3, 1, 5);

  return {
    ...concept,
    days_since_due: daysSinceDue,
    concept_priority_score: importance * 2 + daysSinceDue * 2,
  };
}

export function mapLeetcodeTopic(topicTags = []) {
  const tagSlugs = new Set(topicTags.map(tag => tag.slug));

  for (const slug of LEETCODE_TOPIC_PRIORITY) {
    if (!tagSlugs.has(slug)) continue;

    const topicId = LEETCODE_TOPIC_MAP[slug];
    if (topicId) return topicId;
  }

  return null;
}
