# DSA Planner & Spaced Repetition Maintainer

This updated implementation plan takes the classic, robust stack taught in Angela Yu's Web Development Bootcamp. We will avoid heavy frameworks and ORMs like Next.js and Prisma, sticking to pure SQL, Javascript, and Express.

Since your goal is to **learn and build this step by step**, my role will act as a mentor. We will initialize the basics together, and I will hand you boilerplates to slowly build out the app logic.

---

## The Tech Stack
*   **Backend framework**: Node.js & Express.
*   **Templating engine**: EJS (Embedded JavaScript) to render HTML dynamically on the server.
*   **Database**: PostgreSQL using the `pg` client to write plain raw SQL queries! 
*   **Frontend**: Vanilla CSS and minimal Vanilla JavaScript in the `public/` folder, using Axios if we need client-side AJAX requests.

---

## Detailed Feature Requirements

1. **Problem Logging & Timer Tracking**:
   - Add Problem flow: Input URL, Title.
   - For approaches: A UI with a `+` button to add multiple approaches.
   - Each approach has a dedicated **Timer** (Start/Stop). Time gets saved along with the approach.
   - Approach metadata: Text/Code, Time Complexity, Space Complexity, Time Taken.
   - **Hints**: Dropdown per approach to store hints added during the first attempt.
   - **Optimal Code**: A dedicated section to paste the absolute most optimal version of the code.

2. **Hidden Metadata**:
   - Tags like `Topics` and `Data Structures Used` are stored but hidden inside a dropdown by default to prevent spoilers when doing Random Reviews.

3. **Spaced Repetition Algorithm (Power of Two)**:
   - Ratings are **1 to 5** (1 = Easiest, 5 = Hardest).
   - Rating = number of repetition rounds required.
   - Intervals: gaps of powers of 2. (Round 1 = +2 days, Round 2 = +4 days, Round 3 = +8 days, etc.)

---

## PostgreSQL Database Schema (Raw SQL)

Instead of Prisma, we will execute raw SQL scripts like this (we will build these step-by-step):

```sql
CREATE TABLE problems (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    url TEXT,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    status VARCHAR(50) DEFAULT 'LEARNING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    problem_id INT REFERENCES problems(id),
    name VARCHAR(100),
    type VARCHAR(50) -- e.g., 'TOPIC' or 'DATA_STRUCTURE'
);

CREATE TABLE approaches (
    id SERIAL PRIMARY KEY,
    problem_id INT REFERENCES problems(id),
    content TEXT,
    time_complexity VARCHAR(50),
    space_complexity VARCHAR(50),
    time_taken_seconds INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Note: We will add 'hints' and 'reviews' tables later.
```

---

## Roadmap: Step-by-Step

### Phase 1: Barebones Server & Views
*   Initialize `package.json`, install `express`, `ejs`, `pg`, `axios`.
*   Create `server.js` and set up the Express boilerplate (middlewares, public folder, view engine).
*   Create `views/index.ejs` and `public/styles.css`.

### Phase 2: Connecting to Postgres
*   Create the database in pgAdmin.
*   Setup the `pg` Pool connection.
*   Write scripts to execute the `CREATE TABLE` commands.

### Phase 3: Problem Dashboard (EJS & Express routes)
*   Build the `GET /` route to show the empty dashboard.
*   Build the `GET /new` route to show the form for adding a problem.
*   Build the `POST /add` route to INSERT into `problems`.

### Phase 4: Javascript Timers & Add Approaches
*   We'll use client-side JS (in the `public` folder) and Axios to handle the stopwatch UI when practicing.

### Phase 5: Spaced Repetition logic
*   Write SQL queries retrieving records where `review_date <= CURRENT_DATE`.
