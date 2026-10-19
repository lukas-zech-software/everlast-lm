import { randomUUID } from "node:crypto";
import type { Queryable } from "./transaction.ts";

/**
 * Local user mapping for verified Identity Platform subjects (FR-WM-04, NFR-SEC-01).
 * Ownership keys on (issuer, subject), never on email.
 */

export interface VerifiedPrincipal {
  issuer: string;
  subject: string;
  email?: string | undefined;
}

export interface UserRecord {
  id: string;
  issuer: string;
  subject: string;
}

export async function ensureUser(db: Queryable, principal: VerifiedPrincipal): Promise<UserRecord> {
  const result = await db.query<UserRecord>(
    `INSERT INTO users (id, issuer, subject, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (issuer, subject)
     DO UPDATE SET email = EXCLUDED.email, updated_at = now()
       WHERE users.email IS DISTINCT FROM EXCLUDED.email
     RETURNING id, issuer, subject`,
    [randomUUID(), principal.issuer, principal.subject, principal.email ?? null]
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await db.query<UserRecord>(
    "SELECT id, issuer, subject FROM users WHERE issuer = $1 AND subject = $2",
    [principal.issuer, principal.subject]
  );
  return existing.rows[0]!;
}
