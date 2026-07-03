import { db } from "../db/pool.js";
import { getFollowCounts, getFollowStatus } from "./socialService.js";

export async function getProfileUser(userId) {
  const result = await db.query(
    `SELECT id, username, bio, profile_pic_url, is_public, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

export async function updateProfile(userId, { bio, profile_pic_url, is_public }) {
  const result = await db.query(
    `UPDATE users
     SET bio = $1,
         profile_pic_url = $2,
         is_public = $3
     WHERE id = $4
     RETURNING id, username, bio, profile_pic_url, is_public, created_at`,
    [
      bio?.trim() || null,
      profile_pic_url?.trim() || null,
      is_public === "private" ? false : true,
      userId,
    ]
  );

  return result.rows[0] || null;
}

export async function getSolvedStats(userId) {
  const result = await db.query(
    `SELECT
        COUNT(*)::INTEGER AS total_solved,
        COUNT(*) FILTER (WHERE ap.difficulty = 'Easy')::INTEGER AS easy_solved,
        COUNT(*) FILTER (WHERE ap.difficulty = 'Medium')::INTEGER AS medium_solved,
        COUNT(*) FILTER (WHERE ap.difficulty = 'Hard')::INTEGER AS hard_solved
     FROM problems_solved ps
     LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
     WHERE ps.user_id = $1`,
    [userId]
  );

  return result.rows[0] || {
    total_solved: 0,
    easy_solved: 0,
    medium_solved: 0,
    hard_solved: 0,
  };
}

export async function getRecentSolvedProblems(userId, limit = 10, includePrivate = false) {
  const visibilityClause = includePrivate ? "" : "AND ps.visibility = 'public'";
  const result = await db.query(
    `SELECT ps.id,
            ps.created_at,
            ps.status,
            COALESCE(ap.title, 'Unmapped Problem') AS title,
            CASE
              WHEN ap.platform = 'neetcode250'
                THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url)
              ELSE ap.url
            END AS url,
            ap.difficulty,
            ap.platform,
            t.name AS topic_name
     FROM problems_solved ps
     LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
     LEFT JOIN topics t ON COALESCE(ps.topic_id, ap.topic) = t.id
     WHERE ps.user_id = $1
       ${visibilityClause}
     ORDER BY ps.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
}

export async function buildProfilePage(viewerId, profileId) {
  const profileUser = await getProfileUser(profileId);
  if (!profileUser) return null;

  const isOwnProfile = viewerId === profileUser.id;
  const followStatus = await getFollowStatus(viewerId, profileUser.id);
  const canViewRecentProblems = isOwnProfile || followStatus === "accepted";
  const stats = await getSolvedStats(profileUser.id);
  const followCounts = await getFollowCounts(profileUser.id);
  const recentProblems = canViewRecentProblems
    ? await getRecentSolvedProblems(profileUser.id, 10, isOwnProfile)
    : [];

  return {
    profileUser,
    stats,
    recentProblems,
    isOwnProfile,
    followStatus,
    followCounts,
    canViewRecentProblems,
  };
}
