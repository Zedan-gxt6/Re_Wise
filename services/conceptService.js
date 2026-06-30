import { db } from "../db/pool.js";

export async function getConceptBooks(userId) {
  const result = await db.query(
    "SELECT id, name FROM concept_books WHERE user_id = $1 ORDER BY name ASC",
    [userId]
  );

  return result.rows;
}

export async function resolveConceptBook(userId, existingBookId, newBookName) {
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

  const result = await db.query(
    "SELECT id FROM concept_books WHERE id = $1 AND user_id = $2",
    [parsedBookId, userId]
  );

  return result.rows[0]?.id || null;
}
