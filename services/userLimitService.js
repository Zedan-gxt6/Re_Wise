import { db } from "../db/pool.js";

export const MAX_USERS = 100;

export async function hasUserCapacity() {
  const result = await db.query("SELECT COUNT(*)::INTEGER AS count FROM users");
  return (result.rows[0]?.count || 0) < MAX_USERS;
}

export async function assertUserCapacity() {
  if (await hasUserCapacity()) return;

  const error = new Error(`Re_Wise is currently limited to ${MAX_USERS} users.`);
  error.code = "USER_LIMIT_REACHED";
  throw error;
}
