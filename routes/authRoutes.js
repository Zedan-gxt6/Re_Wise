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
  const { username, password, bio, profile_pic_url, is_public } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  try {
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
    if (e.code === "23505") return res.status(409).json({ error: "Username already exists" });
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

router.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send("Logout failed");
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

export default router;
