# Re_Wise

Re_Wise is a full-stack DSA revision and progress tracking platform built to help users not just solve coding problems, but remember, review, and improve from them over time.

Most DSA trackers only store solved problems. Re_Wise focuses on what happens after solving: saving the approach, tracking mistakes, scheduling future reviews, revising concepts, and learning from people in your circle.

## Live Demo

```text
https://re-wise.onrender.com
```

## Core Idea

Solving a problem once is not enough. The real challenge is remembering the approach later.

Re_Wise helps users answer:

- What problems have I solved?
- Which ones should I revise today?
- What mistake did I make last time?
- How independently did I solve it?
- Which topics am I weak in?
- How did people I follow solve the same problem?
- Which concepts should I review?

## Features

### Problem Tracking

Users can save solved problems with detailed metadata:

- problem URL
- platform
- difficulty
- topic
- time taken
- independence level
- solution approach
- mistakes made
- hardest part
- gradual hints
- public/private visibility

For supported problem URLs, Re_Wise can detect metadata automatically and store the problem in the shared problem bank.

Internally, solved problems are stored in `problems_solved`, while reusable problem metadata is stored in `all_problems`.

### Smart Revision Scheduling

Re_Wise schedules future reviews based on how the user solved the problem.

The scheduling logic considers:

- problem difficulty
- time taken
- independence level
- topic decay constant
- revision feedback
- current memory strength
- review threshold

Each solved problem stores data such as base strength, current threshold, due date, revision count, topic, and status. This allows the app to decide when a problem should come back for review.

### Daily Revision Plan

Instead of showing every overdue problem, Re_Wise creates a manageable daily revision plan.

When the dashboard or due revision page is opened, the app:

1. Fetches all due problems.
2. Checks if today's revision plan already exists.
3. If not, selects a balanced set of problems for the day.
4. Stores them in `revision_daily_plans`.
5. Reuses the same plan for the rest of the day.

This keeps daily revision focused and avoids recalculating the plan repeatedly.

### Revision Feedback

When reviewing a problem, users can mark whether they:

- fully remembered it
- partially forgot it
- forgot the approach

This feedback updates the problem's revision schedule and future review timing.

### Concept Tracking

Re_Wise supports concept revision separately from problem revision.

Users can:

- save concepts
- organize concepts into books
- set review intervals
- mark concepts as revised or mastered
- view due concepts

This is useful because DSA preparation includes patterns, theory, tricks, and explanations, not just solved problems.

### Dashboard

The dashboard gives a quick overview of progress:

- total solved problems
- problems solved today
- due revision problems
- due concepts
- last 7 days activity
- topic-wise solved stats
- shortcuts to all problems and all concepts

The dashboard is optimized using parallel database queries and indexes.

### Topic Analytics

Re_Wise tracks solved problems by topic so users can see which areas they are practicing most.

Examples:

- Arrays & Hashing
- Two Pointers
- Sliding Window
- Binary Search
- Trees
- Graphs
- Dynamic Programming
- Greedy
- Math
- Bit Manipulation

Even topics with zero solved problems can be shown, making weak areas visible.

### In-Memory Caching

Re_Wise includes a lightweight custom cache built with JavaScript `Map`.

Currently cached:

- topics
- all problem metadata

The cache loads when the server starts and is used for read-heavy operations like problem lookup and topic access.

This reduces repeated database calls while keeping important user data safely stored in PostgreSQL.

### Social Learning

Users can follow each other and learn from public problem cards.

When solving a problem, Re_Wise can show public solve cards from people the user follows who solved the same problem.

Each card can include:

- approach
- mistakes
- hardest part
- hints
- time taken
- independence level

To keep the page fast, only up to 10 matching followed-user cards are fetched.

### Notifications

Re_Wise includes a notification system for social activity:

- follow requests
- accepted follows
- problem card likes
- comments
- followed users solving problems

Duplicate follower solve notifications are prevented so repeated clicks do not spam users.

### Authentication

Re_Wise supports two login methods:

- username/password login
- Google OAuth login

Password login uses hashed passwords with `bcrypt`.

Google login uses verified Google email and Google ID. Existing local accounts can be linked with Google login through the same email, so users do not lose their solved problems or profile data.

Account types include:

- local login only
- Google login only
- both local and Google login

### Profile Management

Users can edit:

- username
- bio
- profile photo URL
- privacy setting
- local password

Google-only users can set a local Re_Wise password later. Users with existing passwords must enter their current password before changing it.

Profiles also show solved stats, recent visible problem cards, followers count, and following count.

### Privacy

Problem cards can be marked as:

- public to followers
- private only me

Private problem cards are hidden from other users.

Public cards are only visible to accepted followers, not the entire internet.

### Feedback and Bug Reports

Re_Wise includes a feedback form in the navbar.

Users can submit:

- bug reports
- improvement ideas
- confusing behavior
- general feedback

Feedback is stored in PostgreSQL in the `feedback_reports` table for later review.

## Performance Optimizations

Re_Wise includes several practical optimizations:

- database indexes for common queries
- parallel dashboard queries
- in-memory cache for reference data
- limited social card fetching
- rate limiting for login and signup
- duplicate notification prevention
- non-blocking follower notifications after scheduling
- direct dashboard redirect after scheduling

## Security Features

- password hashing with bcrypt
- PostgreSQL-backed sessions
- production `SESSION_SECRET` requirement
- login/signup rate limiting
- Google OAuth state validation
- verified email requirement for Google login
- HTTP security headers
- protected authenticated routes
- private/public profile and problem card controls

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- EJS
- bcrypt
- express-session
- connect-pg-simple
- Google OAuth
- Render
- Neon PostgreSQL

## Project Structure

```text
routes/        Express route handlers
services/      Business logic and reusable database operations
views/         EJS templates
public/        CSS and static assets
db/            Database pool and migrations
middleware/    Auth and rate limiting middleware
utils/         Scheduling and problem helper logic
```

## Important Database Tables

```text
users
topics
all_problems
problems_solved
revision_daily_plans
concepts
concept_books
concept_daily_plans
follows
notifications
problem_card_likes
problem_card_comments
feedback_reports
```

## How It Works Internally

Re_Wise follows a simple route-service-database structure.

Routes handle HTTP requests and responses.

Services contain reusable logic such as:

- saving solved problems
- scheduling revisions
- fetching social cards
- creating notifications
- managing profile updates
- handling Google OAuth users

PostgreSQL stores persistent data, while in-memory cache is used only for safe reference data.

Important user actions, such as solved problems, concepts, feedback, sessions, and notifications, are always stored in the database.

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env`:

```env
DATABASE_URL=your_database_url
SESSION_SECRET=your_long_random_secret
NODE_ENV=development
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

Run database setup or migrations:

```bash
npm run db:setup
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Deployment

The app is deployed using:

- Render for the Node.js web service
- Neon for PostgreSQL

Production environment variables include:

```env
DATABASE_URL=
SESSION_SECRET=
NODE_ENV=production
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://re-wise.onrender.com/auth/google/callback
```

## Future Improvements

Possible future additions:

- pagination for large problem lists
- admin feedback dashboard
- email reminders
- background worker for daily revision planning
- Redis cache
- password reset flow
- richer analytics
- mobile UI improvements
- public landing page
- test suite

## Summary

Re_Wise is more than a solved-problem tracker. It is a revision-first DSA platform that helps users save what they learned, schedule what they might forget, review consistently, track concepts, and learn from their social circle.
