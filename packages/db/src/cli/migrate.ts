import { createPool, runMigrations } from "../index.ts";

/** `pnpm db:migrate`: applies pending migrations to DATABASE_URL (or PG* variables). */
const pool = createPool();
try {
  const applied = await runMigrations(pool);
  console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database schema is up to date");
} finally {
  await pool.end();
}
