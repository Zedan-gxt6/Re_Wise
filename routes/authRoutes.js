import express from "express";
import bcrypt from "bcrypt";
import { db } from "../db/pool.js";
import { seedUserConstants } from "../services/problemService.js";

const router = express.Router();

router.get("/api/session", (req, res) => {
  res.json({ authenticated: Boolean(req.session?.userId) });
});

router.get("/login", (req, res) => res.render("login.ejs"));
router.get("/signup", (req, res) => res.render("signup.ejs"));

router.post("/api/signup", async (req, res) => {
  const { username, password, skill_level, prep_duration } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const prepMonths = prep_duration ? parseInt(prep_duration, 10) : null;
    const result = await db.query(
      `INSERT INTO users (username, password_hashed, "prepDuration", skill_level)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [username, hashed, prepMonths, skill_level]
    );
    const userId = result.rows[0].id;
    await seedUserConstants(userId);
    req.session.userId = userId;
    res.json({ message: "Signup successful" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Signup failed" });
  }
});

router.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const { rows } = await db.query("SELECT id, password_hashed FROM users WHERE username=$1", [username]);
    if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, rows[0].password_hashed);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    req.session.userId = rows[0].id;
    res.json({ message: "Login successful" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login error" });
  }
});

router.post("/api/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out" });
  });
});

export default router;
