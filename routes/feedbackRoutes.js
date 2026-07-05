import express from "express";
import { db } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.get("/feedback", requireAuth, (req, res) => {
  res.render("feedback.ejs", { submitted: req.query.submitted === "1", error: null });
});

router.post("/feedback", requireAuth, async (req, res) => {
  const message = String(req.body.message || "").trim();

  if (message.length < 5) {
    return res.status(400).render("feedback.ejs", {
      submitted: false,
      error: "Please write at least a few words.",
    });
  }

  try {
    await db.query(
      `INSERT INTO feedback_reports (user_id, message)
       VALUES ($1, $2)`,
      [req.session.userId, message]
    );

    res.redirect("/feedback?submitted=1");
  } catch (error) {
    console.error("Feedback submit error:", error);
    res.status(500).render("feedback.ejs", {
      submitted: false,
      error: "Could not submit feedback right now.",
    });
  }
});

export default router;
