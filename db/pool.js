import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

export const db = new pg.Pool({
  user: "postgres",
  host: "localhost",
  database: "dsa_tracker",
  password: process.env.DB_PASSWORD,
  port: 5432,
});

db.connect();
