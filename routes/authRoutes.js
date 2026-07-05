import express from "express";
import bcrypt from "bcrypt";
import { db } from "../db/pool.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { seedUserConstants } from "../services/problemService.js";
import { assertUserCapacity, MAX_USERS } from "../services/userLimitService.js";

const router = express.Router();
const loginRateLimit = createRateLimiter({
  name: "login",
  windowMs: 1000 * 60 * 15,
  maxRequests: 10,
});
const signupRateLimit = createRateLimiter({
  name: "signup",
  windowMs: 1000 * 60 * 60,
  maxRequests: 5,
});

router.get("/api/session", (req, res) => {
  res.json({ authenticated: Boolean(req.session?.userId) });
});

router.get("/login", (req, res) => res.render("login.ejs"));
router.get("/signup", (req, res) => res.render("signup.ejs"));

router.post("/api/signup", signupRateLimit, async (req, res) => {
  const { username, password, bio, profile_pic_url, is_public } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  try {
    await assertUserCapacity();
    const hashed = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (username, password_hashed, bio, profile_pic_url, is_public)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        username.trim(),
        hashed,
        bio?.trim() || null,
        profile_pic_url?.trim() || null,
        is_public === "private" ? false : true,
      ]
    );
    const userId = result.rows[0].id;
    await seedUserConstants(userId);
    req.session.userId = userId;
    res.json({ message: "Signup successful" });
  } catch (e) {
    console.error(e);
    if (e.code === "USER_LIMIT_REACHED") {
      return res.status(403).json({ error: `Re_Wise is currently limited to ${MAX_USERS} users.` });
    }
    if (e.code === "23505") return res.status(409).json({ error: "Username already exists" });
    res.status(500).json({ error: "Signup failed" });
  }
});

router.post("/api/login", loginRateLimit, async (req, res) => {
  const { username, password } = req.body;

  try {
    const { rows } = await db.query("SELECT id, password_hashed FROM users WHERE username=$1", [username]);
    if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });
    if (!rows[0].password_hashed) {
      return res.status(401).json({ error: "Use Google login for this account" });
    }

    const valid = await bcrypt.compare(password, rows[0].password_hashed);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    req.session.userId = rows[0].id;
    res.json({ message: "Login successful" });
  } catch (e) {
    console.error("Login error:", {
      code: e.code,
      message: e.message,
      detail: e.detail,
      table: e.table,
      column: e.column,
      constraint: e.constraint,
    });
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

router.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send("Logout failed");
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

export default router;
