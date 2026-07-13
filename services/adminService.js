import { db } from "../db/pool.js";

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error || "Unknown error"),
    stack: error?.stack || null,
    code: error?.code || null,
    detail: error?.detail || null,
    table: error?.table || null,
    column: error?.column || null,
    constraint: error?.constraint || null,
  };
}

export async function logAppError(error, req) {
  const serialized = serializeError(error);

  const result = await db.query(
    `INSERT INTO app_errors
       (user_id, method, route, message, stack, details)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at, message, stack, details`,
    [
      req?.session?.userId || null,
      req?.method || null,
      req?.originalUrl || req?.url || null,
      serialized.message,
      serialized.stack,
      serialized,
    ]
  );

  return result.rows[0];
}

export async function getAdminStats() {
  const [
    usersResult,
    feedbackResult,
    errorsResult,
  ] = await Promise.all([
    db.query("SELECT COUNT(*)::INTEGER AS count FROM users"),
    db.query(
      `SELECT fr.*, u.username
       FROM feedback_reports fr
       LEFT JOIN users u ON u.id = fr.user_id
       ORDER BY fr.created_at DESC`
    ),
    db.query(
      `SELECT ae.*, u.username
       FROM app_errors ae
       LEFT JOIN users u ON u.id = ae.user_id
       ORDER BY ae.created_at DESC`
    ),
  ]);

  return {
    userCount: usersResult.rows[0]?.count || 0,
    feedbacks: feedbackResult.rows,
    errors: errorsResult.rows,
  };
}

export async function resolveFeedback(feedbackId) {
  await db.query(
    `UPDATE feedback_reports
     SET status = 'resolved',
         resolved_at = NOW()
     WHERE id = $1`,
    [feedbackId]
  );
}

export async function resolveAppError(errorId) {
  await db.query(
    `UPDATE app_errors
     SET status = 'resolved',
         resolved_at = NOW()
     WHERE id = $1`,
    [errorId]
  );
}

export async function sendOwnerNotification(ownerId, message) {
  const cleanMessage = String(message || "").trim();
  if (!cleanMessage) return 0;

  const result = await db.query(
    `INSERT INTO notifications
       (user_id, actor_id, type, entity_type, message, target_url)
     SELECT id, $1, 'owner_broadcast', 'admin', $2, NULL
     FROM users
     RETURNING id`,
    [ownerId, `Notification from owner: ${cleanMessage}`]
  );

  return result.rowCount;
}
