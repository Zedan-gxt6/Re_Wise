import { db } from "../db/pool.js";

export async function isOwnerUser(userId) {
  if (parseInt(userId, 10) !== 1) return false;

  const result = await db.query(
    "SELECT id, username FROM users WHERE id = $1 AND username = $2",
    [1, "Zedan"]
  );

  return result.rows.length > 0;
}

export async function attachOwnerFlag(req, res, next) {
  res.locals.isOwner = false;
  if (!req.session?.userId) return next();

  try {
    res.locals.isOwner = await isOwnerUser(req.session.userId);
  } catch (error) {
    console.error("Owner flag check failed:", error);
  }

  next();
}

export async function requireOwner(req, res, next) {
  try {
    if (await isOwnerUser(req.session?.userId)) return next();
    return res.status(403).render("error.ejs", {
      title: "Owner area",
      message: "You do not have access to this page.",
      errorLog: null,
      details: null,
    });
  } catch (error) {
    next(error);
  }
}
