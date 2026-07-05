const topicsCache = new Map();
const allProblemsByUrlCache = new Map();

let cacheReady = false;
let lastLoadedAt = null;

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUrl(value) {
  return normalizeKey(value).replace(/\/+$/, "");
}

function problemUrlKey(platform, url) {
  return `${normalizeKey(platform)}:${normalizeUrl(url)}`;
}

function extractProblemSlug(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const problemIndex = parts.indexOf("problems");

    if (problemIndex >= 0 && parts[problemIndex + 1]) {
      return normalizeKey(parts[problemIndex + 1]);
    }

    return normalizeKey(parts[parts.length - 1] || normalized);
  } catch {
    return normalized.split("/").filter(Boolean).at(-1) || normalized;
  }
}

export async function loadReferenceCache(db) {
  const [topicsResult, problemsResult] = await Promise.all([
    db.query("SELECT id, name, decay_constant FROM topics ORDER BY id"),
    db.query("SELECT id, title, url, difficulty, topic, platform FROM all_problems ORDER BY id"),
  ]);

  topicsCache.clear();
  allProblemsByUrlCache.clear();

  for (const topic of topicsResult.rows) {
    topicsCache.set(Number(topic.id), topic);
  }

  for (const problem of problemsResult.rows) {
    setProblemInCache(problem);
  }

  cacheReady = true;
  lastLoadedAt = new Date();

  return getCacheStats();
}

export function getAllTopicsFromCache() {
  return [...topicsCache.values()];
}

export function getTopicFromCache(id) {
  return topicsCache.get(Number(id)) || null;
}

export function getProblemByUrlFromCache(platform, url) {
  const directMatch = allProblemsByUrlCache.get(problemUrlKey(platform, url));
  if (directMatch) return directMatch;

  const slug = extractProblemSlug(url);
  if (!slug) return null;

  return allProblemsByUrlCache.get(problemUrlKey(platform, slug)) || null;
}

export function setProblemInCache(problem) {
  if (!problem?.platform || !problem?.url) return;

  allProblemsByUrlCache.set(problemUrlKey(problem.platform, problem.url), problem);

  const slug = extractProblemSlug(problem.url);
  if (slug) {
    allProblemsByUrlCache.set(problemUrlKey(problem.platform, slug), problem);
  }
}

export function getCacheStats() {
  return {
    ready: cacheReady,
    lastLoadedAt,
    topics: topicsCache.size,
    allProblemsByUrl: allProblemsByUrlCache.size,
  };
}

export function isReferenceCacheReady() {
  return cacheReady;
}
