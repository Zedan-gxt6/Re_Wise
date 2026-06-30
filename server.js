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

dotenv.config();

const app = express();
const port = 3000;

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
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(problemRoutes);
app.use(conceptRoutes);

app.listen(port, () => {
  console.log(`Server up and running on http://localhost:${port}`);
});
