import type { Pool } from "pg";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration runner and DDL validator (FR-WM-01, FR-WM-04, FR-WM-07).
 */

export function getMigrationsDirectory(): string {
  const localMigrations = join(process.cwd(), "packages/db/migrations");
  if (existsSync(localMigrations)) {
    return localMigrations;
  }
  const relativeMigrations = join(process.cwd(), "migrations");
  if (existsSync(relativeMigrations)) {
    return relativeMigrations;
  }
  return localMigrations;
}

export function getAvailableMigrations(): string[] {
  const dir = getMigrationsDirectory();
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

export interface TableValidation {
  name: string;
  hasColumn: (colName: string, expectedType?: string, options?: { primaryKey?: boolean; unique?: boolean; notNull?: boolean }) => boolean;
  hasForeignKey: (colName: string, targetTable: string, targetCol: string, onDeleteAction?: string) => boolean;
  hasCompositePrimaryKey: (cols: string[]) => boolean;
  hasCheckConstraint: (colName: string, checkExpr?: string) => boolean;
}

export interface DdlValidationResult {
  hasTable: (tableName: string) => boolean;
  getTable: (tableName: string) => TableValidation;
}

export function validateMigrationDdl(ddl: string): DdlValidationResult {
  const normalized = ddl.replace(/--.*$/gm, ""); // strip comments

  const tableBlocks = new Map<string, string>();
  const createTableRegex = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;

  while ((match = createTableRegex.exec(normalized)) !== null) {
    const tableName = match[1]!.toLowerCase();
    const tableBody = match[2]!;
    tableBlocks.set(tableName, tableBody);
  }

  return {
    hasTable: (tableName: string) => tableBlocks.has(tableName.toLowerCase()),
    getTable: (tableName: string): TableValidation => {
      const body = tableBlocks.get(tableName.toLowerCase()) || "";
      const lines = body.split(",").map((l) => l.trim());

      return {
        name: tableName,
        hasColumn: (colName: string, expectedType?: string, options?: { primaryKey?: boolean; unique?: boolean; notNull?: boolean }) => {
          const colPattern = new RegExp(`\\b${colName}\\b\\s+([a-zA-Z0-9_()]+)`, "i");
          const m = body.match(colPattern);
          if (!m) return false;
          if (expectedType) {
            const actualType = m[1]!.toUpperCase();
            if (!actualType.includes(expectedType.toUpperCase())) {
              return false;
            }
          }
          if (options?.primaryKey) {
            const hasInlinePk = new RegExp(`\\b${colName}\\b[^,]*PRIMARY\\s+KEY`, "i").test(body);
            const hasSeparatePk = new RegExp(`PRIMARY\\s+KEY\\s*\\([^)]*\\b${colName}\\b[^)]*\\)`, "i").test(body);
            if (!hasInlinePk && !hasSeparatePk) return false;
          }
          if (options?.unique) {
            const hasUnique = new RegExp(`\\b${colName}\\b[^,]*UNIQUE`, "i").test(body);
            if (!hasUnique) return false;
          }
          if (options?.notNull) {
            const hasNotNull = new RegExp(`\\b${colName}\\b[^,]*NOT\\s+NULL`, "i").test(body);
            if (!hasNotNull && !options?.primaryKey) return false;
          }
          return true;
        },
        hasForeignKey: (colName: string, targetTable: string, targetCol: string, onDeleteAction?: string) => {
          const fkInline = new RegExp(
            `\\b${colName}\\b[^,]*REFERENCES\\s+${targetTable}\\s*\\(\\s*${targetCol}\\s*\\)(?:\\s+ON\\s+DELETE\\s+${onDeleteAction || "CASCADE"})?`,
            "i"
          );
          return fkInline.test(body);
        },
        hasCompositePrimaryKey: (cols: string[]) => {
          const pkPattern = new RegExp(
            `PRIMARY\\s+KEY\\s*\\(\\s*${cols.join("\\s*,\\s*")}\\s*\\)`,
            "i"
          );
          return pkPattern.test(body);
        },
        hasCheckConstraint: (colName: string, checkExpr?: string) => {
          const checkPattern = new RegExp(
            `CHECK\\s*\\(\\s*${colName}\\s*${checkExpr ? checkExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : ""}[^)]*\\)`,
            "i"
          );
          return checkPattern.test(body);
        },
      };
    },
  };
}

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrations = getAvailableMigrations();
    for (const migrationFile of migrations) {
      const filename = migrationFile.split("/").pop()!;
      const checkRes = await client.query(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [filename]
      );
      if (checkRes.rows.length === 0) {
        const sql = readFileSync(migrationFile, "utf8");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [filename]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
