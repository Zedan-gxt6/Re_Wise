import express from "express";
import { db } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.get("/", (req, res) => {
  if (req.session?.userId) return res.redirect("/dashboard");
  return res.redirect("/login");
});

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const totalRes = await db.query("SELECT COUNT(*) FROM problems_solved WHERE user_id = $1", [userId]);
    const todayRes = await db.query(
      "SELECT COUNT(*) FROM problems_solved WHERE user_id = $1 AND created_at >= CURRENT_DATE",
      [userId]
    );

    res.render("index.ejs", {
      totalSolved: parseInt(totalRes.rows[0].count, 10),
      todaySolved: parseInt(todayRes.rows[0].count, 10),
    });
  } catch (err) {
    console.error("Dashboard statistics query error:", err);
    res.status(500).send("Error loading dashboard");
  }
});

export default router;
