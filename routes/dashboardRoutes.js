import express from "express";
import { db } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getOrCreateTodayRevisionPlan } from "../services/schedulerService.js";

const router = express.Router();

router.get("/", (req, res) => {
  if (req.session?.userId) return res.redirect("/dashboard");
  return res.redirect("/login");
});

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const userRes = await db.query("SELECT username FROM users WHERE id = $1", [userId]);
    const totalRes = await db.query("SELECT COUNT(*) FROM problems_solved WHERE user_id = $1", [userId]);
    const todayRes = await db.query(
      "SELECT COUNT(*) FROM problems_solved WHERE user_id = $1 AND created_at >= CURRENT_DATE",
      [userId]
    );
    const dueProblemsRes = await db.query(
      `SELECT ps.*, COALESCE(ap.title, 'Unmapped Problem') AS title,
              ap.difficulty AS problem_difficulty,
              COALESCE(ps.topic_id, ap.topic) AS topic_id
       FROM problems_solved ps
       LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       WHERE ps.user_id = $1
         AND ps.due_date <= NOW()
         AND (ps.status IS NULL OR ps.status != 'MASTERED')`,
      [userId]
    );
    const dueConceptsRes = await db.query(
      `SELECT COUNT(*) FROM concepts
       WHERE userid = $1
         AND due_date <= NOW()
         AND (status IS NULL OR status != 'MASTERED')`,
      [userId]
    );
    const todayRevisionProblems = await getOrCreateTodayRevisionPlan(userId, dueProblemsRes.rows);
    const weeklyRes = await db.query(
      `SELECT TO_CHAR(days.day, 'Dy') AS label,
              COUNT(ps.id)::INTEGER AS count
       FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
       LEFT JOIN problems_solved ps
         ON ps.user_id = $1
        AND ps.created_at::DATE = days.day::DATE
       GROUP BY days.day
       ORDER BY days.day`,
      [userId]
    );
    const topicRes = await db.query(
      `SELECT COALESCE(t.name, 'Unmapped') AS topic_name,
              COUNT(ps.id)::INTEGER AS count
       FROM problems_solved ps
       LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
       LEFT JOIN topics t ON COALESCE(ps.topic_id, ap.topic) = t.id
       WHERE ps.user_id = $1
       GROUP BY t.name
       ORDER BY count DESC, topic_name ASC
       LIMIT 6`,
      [userId]
    );

    res.render("index.ejs", {
      username: userRes.rows[0]?.username || "Coder",
      totalSolved: parseInt(totalRes.rows[0].count, 10),
      todaySolved: parseInt(todayRes.rows[0].count, 10),
      dueProblems: todayRevisionProblems.length,
      dueConcepts: parseInt(dueConceptsRes.rows[0].count, 10),
      weeklySolved: weeklyRes.rows,
      topicSolved: topicRes.rows,
    });
  } catch (err) {
    console.error("Dashboard statistics query error:", err);
    res.status(500).send("Error loading dashboard");
  }
});

export default router;
