import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

import { db } from "./db/pool.js";
import authRoutes from "./routes/authRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import problemRoutes from "./routes/problemRoutes.js";
import conceptRoutes from "./routes/conceptRoutes.js";
import socialRoutes from "./routes/socialRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import googleAuthRoutes from "./routes/googleAuthRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import { loadReferenceCache } from "./services/cacheService.js";
import { getUnreadNotificationCount } from "./services/notificationService.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const sessionSecret = process.env.SESSION_SECRET || "dev-only-session-secret";

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY");
genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});
app.use(session({
  store: new (pgSession(session))({
    pool: db,
    createTableIfMissing: true,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(async (req, res, next) => {
  res.locals.unreadNotifications = 0;
  if (!req.session?.userId) return next();

  try {
    res.locals.unreadNotifications = Number(await getUnreadNotificationCount(req.session.userId)) || 0;
  } catch (error) {
    console.error("Unread notification count error:", error);
  }

  next();
});

app.use(authRoutes);
app.use(googleAuthRoutes);
app.use(dashboardRoutes);
app.use(problemRoutes);
app.use(conceptRoutes);
app.use(socialRoutes);
app.use(notificationRoutes);
app.use(profileRoutes);
app.use(feedbackRoutes);

async function startServer() {
  try {
    const stats = await loadReferenceCache(db);
    console.log("Reference cache loaded:", stats);
  } catch (error) {
    console.error("Reference cache load failed:", error);
  }

  app.listen(port, () => {
    console.log(`Server up and running on http://localhost:${port}`);
  });
}

startServer();
