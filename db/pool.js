import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      user: "postgres",
      host: "localhost",
      database: "dsa_tracker",
      password: process.env.DB_PASSWORD,
      port: 5432,
    };

export const db = new pg.Pool(connectionConfig);
