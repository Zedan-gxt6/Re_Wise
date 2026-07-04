// db_setup.js - Initialise database schema for DSA_IMPR application
// Run this script with `node db_setup.js` after configuring .env

import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

const connectionConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      user: 'postgres',
      host: 'localhost',
      database: 'dsa_tracker',
      password: process.env.DB_PASSWORD,
      port: 5432,
    };

const client = new Client(connectionConfig);

async function setup() {
  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hashed VARCHAR(255) NOT NULL,
        "prepDuration" INTEGER,
        skill_level VARCHAR(50),
        bio TEXT,
        profile_pic_url TEXT,
        is_public BOOLEAN DEFAULT true,
        revision_load NUMERIC DEFAULT 4,
        concept_revision_load NUMERIC DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS topics (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        decay_constant NUMERIC DEFAULT 0.03
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS all_problems (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        url TEXT,
        difficulty VARCHAR(50),
        topic INTEGER REFERENCES topics(id),
        platform VARCHAR(100),
        UNIQUE(platform, url)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS problems_solved (
        id SERIAL PRIMARY KEY,
        prob_id INTEGER REFERENCES all_problems(id) ON DELETE SET NULL,
        platform VARCHAR(100),
        rating INTEGER,
        time INTEGER,
        code TEXT,
        mistake_made TEXT,
        hardest_part TEXT,
        hint_1 TEXT,
        hint_2 TEXT,
        hint_3 TEXT,
        base_strength NUMERIC,
        current_threshold NUMERIC,
        last_rev_date TIMESTAMP,
        review_days INTEGER,
        revisions_done INTEGER DEFAULT 0,
        due_date TIMESTAMP,
        status VARCHAR(20),
        visibility VARCHAR(20) DEFAULT 'public',
        topic_id INTEGER REFERENCES topics(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(user_id, platform, prob_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_constants (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        decay_constant NUMERIC NOT NULL DEFAULT 0.03,
        UNIQUE(user_id, topic_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS revision_daily_plans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_date DATE NOT NULL,
        problem_solved_id INTEGER NOT NULL REFERENCES problems_solved(id) ON DELETE CASCADE,
        completed_at TIMESTAMP,
        load_adjusted BOOLEAN DEFAULT FALSE,
        UNIQUE(user_id, plan_date, problem_solved_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_books (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        UNIQUE(user_id, name)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS concepts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        concept TEXT NOT NULL,
        userid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        due_date TIMESTAMP,
        review_days INTEGER,
        book_id INTEGER REFERENCES concept_books(id) ON DELETE SET NULL,
        priority INTEGER DEFAULT 3,
        status VARCHAR(20) DEFAULT 'LEARNING',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_daily_plans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_date DATE NOT NULL,
        concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        completed_at TIMESTAMP,
        load_adjusted BOOLEAN DEFAULT FALSE,
        UNIQUE(user_id, plan_date, concept_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS follows (
        id SERIAL PRIMARY KEY,
        follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'accepted',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(follower_id, following_id),
        CHECK (follower_id <> following_id),
        CHECK (status IN ('pending', 'accepted'))
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS problem_card_likes (
        id SERIAL PRIMARY KEY,
        problem_solved_id INTEGER NOT NULL REFERENCES problems_solved(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(problem_solved_id, user_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS problem_card_comments (
        id SERIAL PRIMARY KEY,
        problem_solved_id INTEGER NOT NULL REFERENCES problems_solved(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INTEGER,
        message TEXT NOT NULL,
        target_url TEXT,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Insert topics if not already present
    const topicNames = [
      'Arrays & Hashing',
      'Two Pointers',
      'Sliding Window',
      'Binary Search',
      'Linked List',
      'Trees',
      'Heap / Priority Queue / Stack',
      'Backtracking / Recursion',
      'Graphs and Advanced Graphs',
      'Dynamic Programming',
      'Greedy / Intervals',
      'Math & Geometry',
      'Bit Manipulation / Tries'
    ];
    for (const name of topicNames) {
      await client.query(`INSERT INTO topics (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;`, [name]);
    }
    // Ensure default Zedan user exists
    const { rows } = await client.query('SELECT id FROM users WHERE username=$1', ['Zedan']);
    if (rows.length === 0) {
      const hash = await bcrypt.hash('Zedan_dsa', 10);
      await client.query(
        `INSERT INTO users (username, password_hashed, "prepDuration", skill_level) VALUES ($1,$2,$3,$4)`,
        ['Zedan', hash, 2, 'intermediate']
      );
      console.log('Default user Zedan created');
    } else {
      console.log('User Zedan already exists');
    }
    console.log('Database setup complete');
  } catch (e) {
    console.error('Error during DB setup:', e);
  } finally {
    await client.end();
  }
}

setup();
