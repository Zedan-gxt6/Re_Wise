import express from "express";
import { db } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { clamp } from "../utils/problemUtils.js";
import { getConceptBooks, resolveConceptBook } from "../services/conceptService.js";
import {
  getOrCreateTodayConceptPlan,
  markTodayConceptCompleted,
} from "../services/schedulerService.js";

const router = express.Router();

router.get("/concepts/new", requireAuth, async (req, res) => {
  try {
    const books = await getConceptBooks(req.session.userId);
    res.render("new_concept.ejs", { books });
  } catch (e) {
    console.error("New concept form error:", e);
    res.status(500).send("Error loading concept form");
  }
});

router.post("/add_concept", requireAuth, async (req, res) => {
  const { title, concept, review_days, book_id, new_book_name, priority } = req.body;
  const days = parseInt(review_days, 10) || 1;
  const conceptPriority = clamp(parseInt(priority, 10) || 3, 1, 5);

  try {
    const resolvedBookId = await resolveConceptBook(req.session.userId, book_id, new_book_name);
    await db.query(
      `INSERT INTO concepts (title, concept, userid, due_date, review_days, book_id, priority)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 day' * ($4::INTEGER), $4, $5, $6)`,
      [title, concept, req.session.userId, days, resolvedBookId, conceptPriority]
    );
    res.redirect("/concepts");
  } catch (e) {
    console.error("Add concept error:", e);
    res.status(500).send("Error adding concept");
  }
});

router.get("/concepts", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, cb.name AS book_name
       FROM concepts c LEFT JOIN concept_books cb ON c.book_id = cb.id
       WHERE c.due_date <= NOW() AND (c.status IS NULL OR c.status != 'MASTERED') AND c.userid = $1
       ORDER BY c.due_date ASC`,
      [req.session.userId]
    );
    const concepts = await getOrCreateTodayConceptPlan(req.session.userId, result.rows);
    res.render("concepts.ejs", { concepts });
  } catch (e) {
    console.error("Fetch due concepts error:", e);
    res.status(500).send("Error loading concepts");
  }
});

router.get("/concepts/all", requireAuth, async (req, res) => {
  const selectedBook = req.query.book || "";
  const values = [req.session.userId];
  const where = ["c.userid = $1"];

  if (selectedBook) {
    values.push(parseInt(selectedBook, 10));
    where.push(`c.book_id = $${values.length}`);
  }

  try {
    const books = await getConceptBooks(req.session.userId);
    const result = await db.query(
      `SELECT c.*, cb.name AS book_name
       FROM concepts c LEFT JOIN concept_books cb ON c.book_id = cb.id
       WHERE ${where.join(" AND ")}
       ORDER BY c.created_at DESC`,
      values
    );
    res.render("all_concepts.ejs", { concepts: result.rows, books, selectedBook });
  } catch (e) {
    console.error("All concepts error:", e);
    res.status(500).send("Error loading all concepts");
  }
});

router.get("/concepts/:id/edit", requireAuth, async (req, res) => {
  try {
    const books = await getConceptBooks(req.session.userId);
    const result = await db.query(
      "SELECT * FROM concepts WHERE id = $1 AND userid = $2",
      [req.params.id, req.session.userId]
    );

    if (result.rows.length === 0) return res.status(404).send("Concept not found");

    res.render("edit_concept.ejs", { concept: result.rows[0], books });
  } catch (e) {
    console.error("Edit concept form error:", e);
    res.status(500).send("Error loading concept editor");
  }
});

router.post("/concepts/:id/update", requireAuth, async (req, res) => {
  const { title, concept, review_days, book_id, new_book_name, priority } = req.body;
  const days = parseInt(review_days, 10) || 1;
  const conceptPriority = clamp(parseInt(priority, 10) || 3, 1, 5);

  if (!title?.trim() || !concept?.trim()) return res.status(400).send("Title and concept are required");

  try {
    const resolvedBookId = await resolveConceptBook(req.session.userId, book_id, new_book_name);
    const result = await db.query(
      `UPDATE concepts
       SET title = $1, concept = $2, review_days = $3, book_id = $4, priority = $5
       WHERE id = $6 AND userid = $7`,
      [title.trim(), concept.trim(), days, resolvedBookId, conceptPriority, req.params.id, req.session.userId]
    );

    if (result.rowCount === 0) return res.status(404).send("Concept not found");

    res.redirect("/concepts/all");
  } catch (e) {
    console.error("Update concept error:", e);
    res.status(500).send("Error updating concept");
  }
});

router.post("/concepts/:id/master", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      "UPDATE concepts SET status = 'MASTERED' WHERE id = $1 AND userid = $2",
      [req.params.id, req.session.userId]
    );

    if (result.rowCount === 0) return res.status(404).send("Concept not found");

    await markTodayConceptCompleted(req.session.userId, req.params.id);
    res.redirect("/concepts");
  } catch (e) {
    console.error("Master concept error:", e);
    res.status(500).send("Error mastering concept");
  }
});

router.post("/concepts/:id/rotate", requireAuth, async (req, res) => {
  const days = parseInt(req.body.review_days, 10) || 1;

  try {
    const result = await db.query(
      `UPDATE concepts
       SET status = 'LEARNING', review_days = $1, due_date = NOW() + INTERVAL '1 day' * ($1::INTEGER)
       WHERE id = $2 AND userid = $3`,
      [days, req.params.id, req.session.userId]
    );

    if (result.rowCount === 0) return res.status(404).send("Concept not found");

    await markTodayConceptCompleted(req.session.userId, req.params.id);
    res.redirect("/concepts");
  } catch (e) {
    console.error("Rotate concept error:", e);
    res.status(500).send("Error rotating concept");
  }
});

export default router;
