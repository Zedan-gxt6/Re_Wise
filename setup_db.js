import pg from 'pg';
const { Client } = pg;

async function setup() {
    const client1 = new Client({
        user: "postgres",
        host: "localhost",
        password: "Zedan@12345",
        port: 5432,
    });
    
    try {
        await client1.connect();
        const res = await client1.query("SELECT 1 FROM pg_database WHERE datname='ironiq'");
        if (res.rowCount === 0) {
            await client1.query("CREATE DATABASE ironiq");
            console.log("Database 'ironiq' created.");
        } else {
            console.log("Database 'ironiq' already exists.");
        }
    } catch (e) {
        console.error("Error creating DB:", e);
    } finally {
        await client1.end();
    }

    const client2 = new Client({
        user: "postgres",
        host: "localhost",
        database: "ironiq",
        password: "Zedan@12345",
        port: 5432,
    });

    try {
        await client2.connect();
        const sql = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    goal VARCHAR(100),
    experience_level VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100),
    notes TEXT,
    started_at TIMESTAMP,
    ended_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exercises (
    id SERIAL PRIMARY KEY,
    workout_id INTEGER REFERENCES workouts(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    muscle_group VARCHAR(50),
    description TEXT,
    is_custom BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS workout_sets (
    id SERIAL PRIMARY KEY,
    exercise_id INTEGER REFERENCES exercises(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL,
    weight_kg DECIMAL(5, 2),
    reps INTEGER
);

CREATE TABLE IF NOT EXISTS personal_records (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    exercise_id INTEGER REFERENCES exercises(id) ON DELETE CASCADE,
    weight_kg DECIMAL(5, 2),
    reps INTEGER,
    achieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS personal_logs (
    id SERIAL PRIMARY KEY,
    exercise_id INTEGER REFERENCES exercises(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    volume DECIMAL(10, 2)
);

CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id)
);
        `;
        await client2.query(sql);
        console.log("Tables created successfully.");
    } catch (e) {
        console.error("Error creating tables:", e);
    } finally {
        await client2.end();
    }
}

setup();
