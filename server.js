import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = 3000;

// Initialize Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY");
const geminiModel = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

// PostgreSQL Connection Setup 
// IMPORTANT: Replace 'YOUR_PASSWORD' with your local pgAdmin password!
const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "dsa_tracker",
    password: "Zedan@12345",
    port: 5432,
});
db.connect();

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Routes
// 1. Home Dashboard - Only buttons
app.get("/", (req, res) => {
    res.render("index.ejs");
});

// API Route for AI Hints
app.post("/api/hints", async (req, res) => {
    const { problemDescription } = req.body;

    if (!problemDescription) {
        return res.status(400).json({ error: "Problem description is required" });
    }

    const prompt = `For a given problem do the following: 
Problem: ${problemDescription}
Give me The response strictly in the following formate and nothing more or less
Start:
Hint 1: Help me identify the core pattern (e.g., two pointers, sliding window, DP, graph, greedy, etc.) and hint to which data structures to use and prerequisites to solve problem
Hint 2,3:  Break the problem into small logical steps and guide me using progressive hints only span these progressive hints into three seperate hints which progressively discloses the approach
Hint 4: Give psuedo code of the problem in the following pattern
initialised variables/arrays etc, 
pseodo code in partial common programming lang syntax and words like
while(queue isnt empty){
     push all neighbours of top elemnt into the queue and pop
     if(cond) update these variables
} also this should be short and compact. 
Edge cases and common pitfalls: DIsclose all edge cases if any and common pitfalls, only higlisght   2 or 3 main ones 
Time complexity expected for problem:
End.

after End: you can write whatever yuou want in short but manntain strict pattern and nothing more`;

    try {
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        const content = response.text();
        
        res.json({ content });
    } catch (error) {
        console.error("Gemini Error:", error);
        res.status(500).json({ error: `Gemini API Error: ${error.message || "Failed to generate hints"}` });
    }
});

// 2. Render Add Problem Page
app.get("/new", (req, res) => {
    res.render("new.ejs");
});

// 3. Handle Add Problem Form Submission
app.post("/add", async (req, res) => {
    const { title, url, rating, time_taken, code, review_days } = req.body;

    try {
        const query = `
            INSERT INTO problems (title, url, rating, time_taken, code, review_days, due_date) 
            VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 day' * ($6::INTEGER)) RETURNING *;
        `;
        const values = [title, url, rating, time_taken, code, review_days];

        await db.query(query, values);
        res.redirect("/");
    } catch (error) {
        console.error("Error inserting data:", error);
        res.status(500).send("Error adding problem");
    }
});

// 4. Problems by Difficulty
app.get("/problems/:difficulty", async (req, res) => {
    const { difficulty } = req.params;
    let ratingVal = 0;
    let title = "";

    if (difficulty === "easy") { ratingVal = 1; title = "Easy Problems"; }
    else if (difficulty === "medium") { ratingVal = 2; title = "Medium Problems"; }
    else if (difficulty === "hard") { ratingVal = 3; title = "Hard Problems"; }
    else if (difficulty === "due") {
        try {
            const result = await db.query("SELECT * FROM problems WHERE due_date <= NOW() AND (status IS NULL OR status != 'MASTERED') ORDER BY due_date ASC");
            return res.render("problems.ejs", { problems: result.rows, title: "All Due Problems", difficulty: "due" });
        } catch (err) {
            console.error(err);
            return res.status(500).send("Error fetching due problems");
        }
    } else {
        return res.status(404).send("Not found");
    }

    try {
        const result = await db.query("SELECT * FROM problems WHERE rating = $1 ORDER BY created_at DESC", [ratingVal]);
        res.render("problems.ejs", { problems: result.rows, title, difficulty });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching problems");
    }
});

// 5. Mark Problem as Mastered (Fix)
app.post("/problems/:difficulty/:id/master", async (req, res) => {
    try {
        await db.query("UPDATE problems SET status = 'MASTERED' WHERE id = $1", [req.params.id]);
        res.redirect(`/problems/${req.params.difficulty}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating problem");
    }
});

// 6. Rotate Problem (Update due date)
app.post("/problems/:difficulty/:id/rotate", async (req, res) => {
    const { review_days } = req.body;
    try {
        await db.query(`
            UPDATE problems 
            SET status = 'LEARNING', 
                review_days = $1, 
                due_date = NOW() + INTERVAL '1 day' * ($1::INTEGER) 
            WHERE id = $2
        `, [review_days, req.params.id]);
        res.redirect(`/problems/${req.params.difficulty}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error rotating problem");
    }
});

// 7. Choose a Random Problem
app.get("/problems/:difficulty/random", async (req, res) => {
    const { difficulty } = req.params;
    let query = "";
    let params = [];

    if (difficulty === "easy") { query = "SELECT url FROM problems WHERE rating = 1 ORDER BY RANDOM() LIMIT 1"; }
    else if (difficulty === "medium") { query = "SELECT url FROM problems WHERE rating = 2 ORDER BY RANDOM() LIMIT 1"; }
    else if (difficulty === "hard") { query = "SELECT url FROM problems WHERE rating = 3 ORDER BY RANDOM() LIMIT 1"; }
    else if (difficulty === "due") { query = "SELECT url FROM problems WHERE due_date <= NOW() AND (status IS NULL OR status != 'MASTERED') ORDER BY RANDOM() LIMIT 1"; }
    else { return res.status(404).send("Not found"); }

    try {
        const result = await db.query(query);
        if (result.rows.length > 0) {
            res.redirect(result.rows[0].url);
        } else {
            res.redirect(`/problems/${difficulty}`);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching random problem");
    }
});

// Start the server
app.listen(port, () => {
    console.log(`🚀 Server up and running on http://localhost:${port}`);
});
