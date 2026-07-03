import { db } from "../db/pool.js";

export async function getFollowStatus(followerId, followingId) {
  if (followerId === followingId) return "self";

  const result = await db.query(
    `SELECT status
     FROM follows
     WHERE follower_id = $1 AND following_id = $2`,
    [followerId, followingId]
  );

  return result.rows[0]?.status || "none";
}

export async function isAcceptedFollower(followerId, followingId) {
  return (await getFollowStatus(followerId, followingId)) === "accepted";
}

export async function searchUsers(currentUserId, query) {
  const searchTerm = `%${query.trim().toLowerCase()}%`;
  const result = await db.query(
    `SELECT u.id,
            u.username,
            u.bio,
            u.profile_pic_url,
            u.is_public,
            f.status AS follow_status
     FROM users u
     LEFT JOIN follows f
       ON f.follower_id = $1 AND f.following_id = u.id
     WHERE u.id != $1 AND LOWER(u.username) LIKE $2
     ORDER BY u.username
     LIMIT 20`,
    [currentUserId, searchTerm]
  );

  return result.rows;
}

export async function followUser(followerId, followingId) {
  if (followerId === followingId) return { status: "self" };

  const target = await db.query(
    "SELECT id, is_public FROM users WHERE id = $1",
    [followingId]
  );
  if (target.rows.length === 0) return null;

  const status = target.rows[0].is_public ? "accepted" : "pending";

  const result = await db.query(
    `INSERT INTO follows (follower_id, following_id, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (follower_id, following_id)
     DO UPDATE SET status = EXCLUDED.status
     RETURNING status`,
    [followerId, followingId, status]
  );

  return result.rows[0];
}

export async function unfollowUser(followerId, followingId) {
  await db.query(
    "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2",
    [followerId, followingId]
  );
}

export async function removeFollower(userId, followerId) {
  await db.query(
    "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2",
    [followerId, userId]
  );
}

export async function getFollowers(userId) {
  const result = await db.query(
    `SELECT f.id AS follow_id,
            u.id,
            u.username,
            u.bio,
            u.profile_pic_url,
            f.created_at
     FROM follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.following_id = $1 AND f.status = 'accepted'
     ORDER BY f.created_at DESC`,
    [userId]
  );

  return result.rows;
}

export async function getFollowing(userId) {
  const result = await db.query(
    `SELECT f.id AS follow_id,
            u.id,
            u.username,
            u.bio,
            u.profile_pic_url,
            f.created_at
     FROM follows f
     JOIN users u ON u.id = f.following_id
     WHERE f.follower_id = $1 AND f.status = 'accepted'
     ORDER BY f.created_at DESC`,
    [userId]
  );

  return result.rows;
}

export async function getPendingFollowRequests(userId) {
  const result = await db.query(
    `SELECT f.id, f.created_at, u.id AS requester_id, u.username, u.bio, u.profile_pic_url
     FROM follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.following_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );

  return result.rows;
}

export async function respondToFollowRequest(userId, requestId, action) {
  if (action === "accept") {
    return db.query(
      `UPDATE follows
       SET status = 'accepted'
       WHERE id = $1 AND following_id = $2 AND status = 'pending'
       RETURNING follower_id, following_id`,
      [requestId, userId]
    );
  }

  return db.query(
    `DELETE FROM follows
     WHERE id = $1 AND following_id = $2 AND status = 'pending'
     RETURNING follower_id, following_id`,
    [requestId, userId]
  );
}

export async function getFollowCounts(userId) {
  const result = await db.query(
    `SELECT
       (SELECT COUNT(*)::INTEGER FROM follows WHERE following_id = $1 AND status = 'accepted') AS followers_count,
       (SELECT COUNT(*)::INTEGER FROM follows WHERE follower_id = $1 AND status = 'accepted') AS following_count,
       (SELECT COUNT(*)::INTEGER FROM follows WHERE following_id = $1 AND status = 'pending') AS pending_requests_count`,
    [userId]
  );

  return result.rows[0] || { followers_count: 0, following_count: 0, pending_requests_count: 0 };
}

export async function canViewProblemCard(viewerId, ownerId) {
  if (viewerId === ownerId) return true;
  return isAcceptedFollower(viewerId, ownerId);
}

export async function getFollowedProblemCards(viewerId, platform, probId) {
  if (!platform || !probId) return [];

  const result = await db.query(
    `SELECT ps.id,
            ps.user_id,
            ps.code,
            ps.mistake_made,
            ps.hardest_part,
            ps.hint_1,
            ps.hint_2,
            ps.hint_3,
            ps.time,
            ps.rating,
            ps.created_at,
            u.username,
            u.profile_pic_url,
            COUNT(DISTINCT pcl.id)::INTEGER AS likes_count,
            COUNT(DISTINCT pcc.id)::INTEGER AS comments_count,
            BOOL_OR(my_like.id IS NOT NULL) AS liked_by_me
     FROM problems_solved ps
     JOIN follows f
       ON f.following_id = ps.user_id
      AND f.follower_id = $1
      AND f.status = 'accepted'
     JOIN users u ON u.id = ps.user_id
     LEFT JOIN problem_card_likes pcl ON pcl.problem_solved_id = ps.id
     LEFT JOIN problem_card_likes my_like
       ON my_like.problem_solved_id = ps.id AND my_like.user_id = $1
     LEFT JOIN problem_card_comments pcc ON pcc.problem_solved_id = ps.id
     WHERE ps.platform = $2
       AND ps.prob_id = $3
       AND ps.visibility = 'public'
     GROUP BY ps.id, u.id
     ORDER BY ps.created_at DESC
     LIMIT 10`,
    [viewerId, platform, probId]
  );

  return result.rows;
}

export async function getCardComments(viewerId, cardId) {
  const access = await getVisibleProblemCard(viewerId, cardId);
  if (!access) return null;

  const result = await db.query(
    `SELECT pcc.id, pcc.comment, pcc.created_at, u.username, u.profile_pic_url
     FROM problem_card_comments pcc
     JOIN users u ON u.id = pcc.user_id
     WHERE pcc.problem_solved_id = $1
     ORDER BY pcc.created_at ASC`,
    [cardId]
  );

  return { card: access, comments: result.rows, canComment: access.user_id !== viewerId };
}

export async function toggleProblemCardLike(viewerId, cardId) {
  const card = await getVisibleProblemCard(viewerId, cardId);
  if (!card || card.user_id === viewerId) return null;

  const deleted = await db.query(
    `DELETE FROM problem_card_likes
     WHERE problem_solved_id = $1 AND user_id = $2
     RETURNING id`,
    [cardId, viewerId]
  );

  if (deleted.rowCount > 0) {
    return { liked: false, likesCount: await getProblemCardLikeCount(cardId) };
  }

  const inserted = await db.query(
    `INSERT INTO problem_card_likes (problem_solved_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (problem_solved_id, user_id) DO NOTHING
     RETURNING id`,
    [cardId, viewerId]
  );

  return { liked: true, likesCount: await getProblemCardLikeCount(cardId), created: inserted.rowCount > 0 };
}

export async function addProblemCardComment(viewerId, cardId, comment) {
  const card = await getVisibleProblemCard(viewerId, cardId);
  if (!card || card.user_id === viewerId) return null;

  const cleanComment = comment?.trim();
  if (!cleanComment) return null;

  return {
    id: cardId,
    problem_solved_id: cardId,
    owner_id: card.user_id,
    comment: cleanComment,
  };
}

async function getVisibleProblemCard(viewerId, cardId) {
  const result = await db.query(
    `SELECT ps.id, ps.user_id
     FROM problems_solved ps
     LEFT JOIN follows f
       ON f.following_id = ps.user_id
      AND f.follower_id = $1
      AND f.status = 'accepted'
     WHERE ps.id = $2
       AND (
         ps.user_id = $1
         OR (ps.visibility = 'public' AND f.id IS NOT NULL)
       )`,
    [viewerId, cardId]
  );

  return result.rows[0] || null;
}

async function getProblemCardLikeCount(cardId) {
  const result = await db.query(
    "SELECT COUNT(*)::INTEGER AS count FROM problem_card_likes WHERE problem_solved_id = $1",
    [cardId]
  );

  return result.rows[0]?.count || 0;
}
