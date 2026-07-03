import { db } from "../db/pool.js";

export async function createNotification({ userId, actorId, type, entityType, entityId, message, targetUrl }) {
  if (!userId || userId === actorId) return null;

  const result = await db.query(
    `INSERT INTO notifications
       (user_id, actor_id, type, entity_type, entity_id, message, target_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, actorId || null, type, entityType || null, entityId || null, message, targetUrl || null]
  );

  return result.rows[0];
}

export async function getUnreadNotificationCount(userId) {
  const result = await db.query(
    "SELECT COUNT(*)::INTEGER AS count FROM notifications WHERE user_id = $1 AND is_read = false",
    [userId]
  );

  return result.rows[0]?.count || 0;
}

export async function getNotifications(userId) {
  const result = await db.query(
    `SELECT n.*, u.username AS actor_username, u.profile_pic_url AS actor_profile_pic_url
     FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT 50`,
    [userId]
  );

  return result.rows;
}

export async function markNotificationRead(userId, notificationId) {
  const result = await db.query(
    `UPDATE notifications
     SET is_read = true
     WHERE id = $1 AND user_id = $2
     RETURNING target_url`,
    [notificationId, userId]
  );

  return result.rows[0] || null;
}

export async function getNotificationForUser(userId, notificationId) {
  const result = await db.query(
    `SELECT *
     FROM notifications
     WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );

  return result.rows[0] || null;
}

export async function markAllNotificationsRead(userId) {
  await db.query(
    "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
    [userId]
  );
}

export async function clearNotifications(userId) {
  await db.query("DELETE FROM notifications WHERE user_id = $1", [userId]);
}

export async function notifyFollowRequest(requesterId, targetUserId) {
  const actor = await getUsername(requesterId);
  return createNotification({
    userId: targetUserId,
    actorId: requesterId,
    type: "follow_request",
    entityType: "follow",
    entityId: requesterId,
    message: `${actor} requested to follow you.`,
    targetUrl: "/follow-requests",
  });
}

export async function notifyFollowAccepted(accepterId, requesterId) {
  const actor = await getUsername(accepterId);
  return createNotification({
    userId: requesterId,
    actorId: accepterId,
    type: "follow_accepted",
    entityType: "user",
    entityId: accepterId,
    message: `${actor} accepted your follow request.`,
    targetUrl: `/users/${accepterId}`,
  });
}

export async function notifyProblemCardLiked(actorId, problemSolvedId) {
  const card = await getProblemCardNotificationInfo(problemSolvedId);
  if (!card) return null;

  const actor = await getUsername(actorId);
  return createNotification({
    userId: card.user_id,
    actorId,
    type: "problem_card_liked",
    entityType: "problem_card",
    entityId: problemSolvedId,
    message: `${actor} liked your ${card.title} problem card.`,
    targetUrl: null,
  });
}

export async function notifyProblemCardCommented(actorId, problemSolvedId, comment) {
  const card = await getProblemCardNotificationInfo(problemSolvedId);
  if (!card) return null;

  const actor = await getUsername(actorId);
  const cleanComment = String(comment || "").trim();
  const preview = cleanComment.length > 160 ? `${cleanComment.slice(0, 157)}...` : cleanComment;

  return createNotification({
    userId: card.user_id,
    actorId,
    type: "problem_card_commented",
    entityType: "problem_card",
    entityId: problemSolvedId,
    message: `${actor} commented on your ${card.title}: "${preview}"`,
    targetUrl: null,
  });
}

export async function notifyFollowersProblemSolved(ownerId, problemSolvedId) {
  const card = await getProblemCardNotificationInfo(problemSolvedId);
  if (!card || card.visibility !== "public") return;

  const actor = await getUsername(ownerId);
  const message = `${actor} solved ${card.title}. Try it now.`;
  const targetUrl = card.url
    ? `/solve?url=${encodeURIComponent(card.url)}`
    : `/users/${ownerId}`;

  await db.query(
    `INSERT INTO notifications
       (user_id, actor_id, type, entity_type, entity_id, message, target_url)
     SELECT f.follower_id, $1, 'followed_user_solved_problem', 'problem_card', $2, $3, $4
     FROM follows f
     WHERE f.following_id = $1
       AND f.status = 'accepted'
       AND f.follower_id != $1`,
    [ownerId, problemSolvedId, message, targetUrl]
  );
}

async function getUsername(userId) {
  const result = await db.query("SELECT username FROM users WHERE id = $1", [userId]);
  return result.rows[0]?.username || "Someone";
}

async function getProblemCardNotificationInfo(problemSolvedId) {
  const result = await db.query(
    `SELECT ps.id,
            ps.user_id,
            ps.visibility,
            COALESCE(ap.title, 'a problem') AS title,
            CASE
              WHEN ap.platform = 'neetcode250'
                THEN 'https://neetcode.io/problems/' || TRIM(TRAILING '/' FROM ap.url)
              ELSE ap.url
            END AS url
     FROM problems_solved ps
     LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
     WHERE ps.id = $1`,
    [problemSolvedId]
  );

  return result.rows[0] || null;
}
