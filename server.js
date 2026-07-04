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
import { getUnreadNotificationCount } from "./services/notificationService.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY");
genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(session({
  store: new (pgSession(session))({
    pool: db,
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || "supersecret",
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
    res.locals.unreadNotifications = await getUnreadNotificationCount(req.session.userId);
  } catch (error) {
    console.error("Unread notification count error:", error);
  }

  next();
});

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(problemRoutes);
app.use(conceptRoutes);
app.use(socialRoutes);
app.use(notificationRoutes);
app.use(profileRoutes);

app.listen(port, () => {
  console.log(`Server up and running on http://localhost:${port}`);
});
