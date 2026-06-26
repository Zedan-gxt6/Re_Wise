import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "dsa_tracker",
    password: process.env.DB_PASSWORD,
    port: 5432,
});

async function migrate() {
    try {
        await db.connect();
        console.log("Connected to database.");

        // 1. Create users table if not exists
        // id, username, password_hashed, prepDuration(in months), skill level(new/intermediate)
        // Let's use column names: id, username, password_hashed, prep_duration_months, skill_level
        // Wait, the user specifically wrote "password_hashed", "prepDuration(in months)", "skill level(new/intermediate)"
        // Let's use camelCase or snake_case but let's check: "password_hashed", "prepDuration", "skill_level"
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hashed VARCHAR(255) NOT NULL,
                "prepDuration" INTEGER,
                skill_level VARCHAR(50)
            );
        `);
        console.log("Created table 'users'.");

        // Add user Zedan
        const hash = await bcrypt.hash("Zedan_dsa", 10);
        const userCheck = await db.query("SELECT id FROM users WHERE username = $1", ["Zedan"]);
        let zedanId;
        if (userCheck.rows.length === 0) {
            const insertUser = await db.query(`
                INSERT INTO users (username, password_hashed, "prepDuration", skill_level)
                VALUES ($1, $2, $3, $4) RETURNING id;
            `, ["Zedan", hash, 2, "intermediate"]);
            zedanId = insertUser.rows[0].id;
            console.log("User 'Zedan' created with ID:", zedanId);
        } else {
            zedanId = userCheck.rows[0].id;
            console.log("User 'Zedan' already exists with ID:", zedanId);
        }

        // 2. Rename problems to problems_solved
        // Check if problems exists and problems_solved does not
        const checkTable = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'problems'
            );
        `);

        if (checkTable.rows[0].exists) {
            await db.query(`ALTER TABLE problems RENAME TO problems_solved;`);
            console.log("Renamed table 'problems' to 'problems_solved'.");
        } else {
            console.log("Table 'problems' does not exist or has already been renamed.");
        }

        // Add user_id column if not exists
        await db.query(`
            ALTER TABLE problems_solved
            ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
        `);
        console.log("Added column 'user_id' referencing 'users(id)' to 'problems_solved'.");

        // Safely convert existing text pattern to integer IDs using temporary column
        await db.query(`
            ALTER TABLE problems_solved ADD COLUMN IF NOT EXISTS pattern_tmp INTEGER;
        `);
        await db.query(`
            UPDATE problems_solved ps
            SET pattern_tmp = t.slno
            FROM topics t
            WHERE t.name = ps.pattern;
        `);
        await db.query(`
            ALTER TABLE problems_solved DROP COLUMN pattern;
        `);
        await db.query(`
            ALTER TABLE problems_solved RENAME COLUMN pattern_tmp TO pattern;
        `);
        console.log("Converted 'pattern' column to INTEGER using topics table via temporary column.");

        // Update all current problems in problems_solved with Zedan's user_id
        await db.query(`
            UPDATE problems_solved
            SET user_id = $1
            WHERE user_id IS NULL;
        `, [zedanId]);
        console.log("Updated all existing problems to be owned by user ID:", zedanId);

    } catch (e) {
        console.error("Migration error:", e);
    } finally {
        await db.end();
    }
}

migrate();
