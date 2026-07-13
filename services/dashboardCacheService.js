const memoryCache = new Map();
const configuredDashboardTtl = parseInt(process.env.DASHBOARD_CACHE_TTL_SECONDS || "", 10);

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayKey() {
  return dateKey();
}

function secondsUntilTomorrow() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
}

function dashboardTtlSeconds() {
  return Number.isInteger(configuredDashboardTtl) && configuredDashboardTtl > 0
    ? configuredDashboardTtl
    : secondsUntilTomorrow();
}

function dashboardKey(userId) {
  return `dashboard:user:${userId}:${todayKey()}`;
}

function isExpired(entry) {
  return !entry || entry.expiresAt <= Date.now();
}

export function getCachedDashboardStats(userId) {
  const key = dashboardKey(userId);
  const entry = memoryCache.get(key);

  if (isExpired(entry)) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value;
}

export function setCachedDashboardStats(userId, value, ttlSeconds = dashboardTtlSeconds()) {
  const key = dashboardKey(userId);
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function isToday(dateValue) {
  if (!dateValue) return false;
  return dateKey(new Date(dateValue)) === todayKey();
}

function dayLabel(dateValue) {
  return new Date(dateValue).toLocaleDateString("en-US", { weekday: "short" });
}

function isInsideDashboardWeek(dateValue) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstVisibleDay = new Date(today);
  firstVisibleDay.setDate(today.getDate() - 6);
  date.setHours(0, 0, 0, 0);

  return date >= firstVisibleDay && date <= today;
}

function isDue(status, dueDate) {
  if (!dueDate || status === "MASTERED") return false;
  return new Date(dueDate).getTime() <= Date.now();
}

function patchCachedDashboardStats(userId, patcher) {
  const cachedStats = getCachedDashboardStats(userId);
  if (!cachedStats) return;

  patcher(cachedStats);
  setCachedDashboardStats(userId, cachedStats);
}

function addToNamedCount(items, matcher, delta) {
  const item = items?.find(matcher);
  if (!item) return;
  item.count = Math.max(0, (parseInt(item.count, 10) || 0) + delta);
}

export function updateDashboardCacheForSolvedProblem(userId, event) {
  if (!event) return;

  patchCachedDashboardStats(userId, (stats) => {
    const inserted = event.type === "inserted";
    const previousWasToday = isToday(event.previousCreatedAt);
    const previousLabel = event.previousCreatedAt ? dayLabel(event.previousCreatedAt) : null;
    const todayLabel = dayLabel(new Date());

    if (inserted) {
      stats.totalSolved = (parseInt(stats.totalSolved, 10) || 0) + 1;
      stats.todaySolved = (parseInt(stats.todaySolved, 10) || 0) + 1;
      addToNamedCount(stats.weeklySolved, (day) => day.label === todayLabel, 1);
      addToNamedCount(stats.topicSolved, (topic) => Number(topic.topic_id) === Number(event.topicId), 1);
      return;
    }

    if (!previousWasToday) {
      stats.todaySolved = (parseInt(stats.todaySolved, 10) || 0) + 1;
      addToNamedCount(stats.weeklySolved, (day) => day.label === todayLabel, 1);
      if (previousLabel && previousLabel !== todayLabel && isInsideDashboardWeek(event.previousCreatedAt)) {
        addToNamedCount(stats.weeklySolved, (day) => day.label === previousLabel, -1);
      }
    }

    if (Number(event.previousTopicId) !== Number(event.topicId)) {
      addToNamedCount(stats.topicSolved, (topic) => Number(topic.topic_id) === Number(event.previousTopicId), -1);
      addToNamedCount(stats.topicSolved, (topic) => Number(topic.topic_id) === Number(event.topicId), 1);
    }

    if (isDue(event.previousStatus, event.previousDueDate)) {
      stats.dueProblems = Math.max(0, (parseInt(stats.dueProblems, 10) || 0) - 1);
    }
  });
}

export function updateDashboardDueProblems(userId, delta) {
  patchCachedDashboardStats(userId, (stats) => {
    stats.dueProblems = Math.max(0, (parseInt(stats.dueProblems, 10) || 0) + delta);
  });
}

export function updateDashboardDueConcepts(userId, delta) {
  patchCachedDashboardStats(userId, (stats) => {
    stats.dueConcepts = Math.max(0, (parseInt(stats.dueConcepts, 10) || 0) + delta);
  });
}
