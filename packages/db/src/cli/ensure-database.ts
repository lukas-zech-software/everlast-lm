import pg from "pg";

/** `node ensure-database.ts <admin-url> <name>` — creates the database when missing (local dev only). */
const [adminUrl, name] = process.argv.slice(2);
if (!adminUrl || !name || !/^[a-z_][a-z0-9_]*$/.test(name)) {
  console.error("usage: ensure-database.ts <admin-url> <database-name>");
  process.exit(64);
}
const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE ${name}`);
} finally {
  await client.end();
}
