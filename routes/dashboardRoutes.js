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
    const [
      userRes,
      totalRes,
      todayRes,
      dueProblemsRes,
      dueConceptsRes,
      weeklyRes,
      topicRes,
    ] = await Promise.all([
      db.query("SELECT username FROM users WHERE id = $1", [userId]),
      db.query("SELECT COUNT(*) FROM problems_solved WHERE user_id = $1", [userId]),
      db.query(
        "SELECT COUNT(*) FROM problems_solved WHERE user_id = $1 AND created_at >= CURRENT_DATE",
        [userId]
      ),
      db.query(
        `SELECT ps.*, COALESCE(ap.title, 'Unmapped Problem') AS title,
                ap.difficulty AS problem_difficulty,
                COALESCE(ps.topic_id, ap.topic) AS topic_id
         FROM problems_solved ps
         LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
         WHERE ps.user_id = $1
           AND ps.due_date <= NOW()
           AND (ps.status IS NULL OR ps.status != 'MASTERED')`,
        [userId]
      ),
      db.query(
        `SELECT COUNT(*) FROM concepts
         WHERE userid = $1
           AND due_date <= NOW()
           AND (status IS NULL OR status != 'MASTERED')`,
        [userId]
      ),
      db.query(
        `WITH solved_by_day AS (
           SELECT ps.created_at::DATE AS solved_day,
                  COUNT(*)::INTEGER AS count
           FROM problems_solved ps
           WHERE ps.user_id = $1
             AND ps.created_at >= CURRENT_DATE - INTERVAL '6 days'
           GROUP BY ps.created_at::DATE
         )
         SELECT TO_CHAR(days.day, 'Dy') AS label,
                COALESCE(solved_by_day.count, 0)::INTEGER AS count
         FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
         LEFT JOIN solved_by_day ON solved_by_day.solved_day = days.day::DATE
         ORDER BY days.day`,
        [userId]
      ),
      db.query(
        `WITH solved_topics AS (
           SELECT COALESCE(ps.topic_id, ap.topic) AS topic_id,
                  COUNT(ps.id)::INTEGER AS count
           FROM problems_solved ps
           LEFT JOIN all_problems ap ON ps.platform = ap.platform AND ps.prob_id = ap.id
           WHERE ps.user_id = $1
           GROUP BY COALESCE(ps.topic_id, ap.topic)
         )
         SELECT t.id AS topic_id,
                t.name AS topic_name,
                COALESCE(solved_topics.count, 0)::INTEGER AS count
         FROM topics t
         LEFT JOIN solved_topics ON solved_topics.topic_id = t.id
         ORDER BY t.id`,
        [userId]
      ),
    ]);
    const todayRevisionProblems = await getOrCreateTodayRevisionPlan(userId, dueProblemsRes.rows);

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
