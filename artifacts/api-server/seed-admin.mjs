import bcrypt from "bcryptjs";
import pg from "pg";
const hash = await bcrypt.hash("biddi-admin", 10);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query("INSERT INTO admins (email, password_hash, name) VALUES ('admin@biddi.app', $1, 'Biddi Admin') ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash", [hash]);
console.log("seeded");
await pool.end();
