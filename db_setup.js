// db_setup.js - Initialise database schema for DSA_IMPR application
// Run this script with `node db_setup.js` after configuring .env

import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'dsa_tracker',
  password: process.env.DB_PASSWORD,
  port: 5432,
});

async function setup() {
  try {
    await client.connect();
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hashed VARCHAR(255) NOT NULL,
        "prepDuration" INTEGER,
        skill_level VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Create topics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS topics (
        slno SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE
      );
    `);
    // Create all_problems table
    await client.query(`
      CREATE TABLE IF NOT EXISTS all_problems (
        id SERIAL PRIMARY KEY,
        problem_title VARCHAR(255) UNIQUE NOT NULL,
        platform VARCHAR(100),
        problem_url TEXT,
        problem_difficulty VARCHAR(50),
        topic INTEGER REFERENCES topics(slno)
      );
    `);
    // Create problems_solved table
    await client.query(`
      CREATE TABLE IF NOT EXISTS problems_solved (
        id SERIAL PRIMARY KEY,
        title INTEGER REFERENCES all_problems(id) ON DELETE SET NULL,
        url TEXT,
        rating INTEGER,
        time INTEGER,
        code TEXT,
        pattern INTEGER,
        review_days INTEGER,
        due_date TIMESTAMP,
        status VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
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
