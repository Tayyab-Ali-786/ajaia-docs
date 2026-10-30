import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

export const SEED_USERS = [
  { email: "alice@ajaia.test", name: "Alice Chen" },
  { email: "bob@ajaia.test", name: "Bob Okafor" },
  { email: "carol@ajaia.test", name: "Carol Diaz" },
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id    SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id         TEXT PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id),
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    version    INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

  CREATE TABLE IF NOT EXISTS document_shares (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id);

  -- Version history. kind: created | edit | restore. Consecutive 'edit' saves by the same user
  -- within a short window are coalesced into one entry so autosave doesn't flood the history.
  CREATE TABLE IF NOT EXISTS document_versions (
    id          SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('created', 'edit', 'restore')),
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_versions_doc ON document_versions(document_id, id DESC);
`;

type Query = (sql: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;

/** Thin wrapper over Postgres (pg pool in prod, PGlite in tests/local dev): db.get / db.all / db.run. */
export class DB {
  constructor(private query: Query, readonly close: () => Promise<void>) {}
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.query(sql, params)).rows as T[];
  }
  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }
  /** Returns the number of affected rows. */
  async run(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.query(sql, params)).rowCount;
  }
}

/**
 * url: "postgres://…" (Supabase in prod) → pg pool.
 *      anything else → embedded PGlite: "memory://" for tests, or a directory path for local persistence.
 * Same Postgres dialect everywhere, so local dev needs no external service.
 */
export async function openDb(url: string): Promise<DB> {
  let db: DB;
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url, max: 5, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });
    db = new DB(async (sql, params) => {
      const r = await pool.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    }, () => pool.end());
    await pool.query(SCHEMA);
  } else {
    const lite = new PGlite(url);
    db = new DB(async (sql, params) => {
      const r = await lite.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? 0 };
    }, () => lite.close());
    await lite.exec(SCHEMA);
  }
  for (const u of SEED_USERS)
    await db.run("INSERT INTO users (email, name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING", [u.email, u.name]);
  return db;
}
