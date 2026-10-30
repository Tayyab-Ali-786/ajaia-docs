import { createClient, type Client, type InArgs } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

export const SEED_USERS = [
  { email: "alice@ajaia.test", name: "Alice Chen" },
  { email: "bob@ajaia.test", name: "Bob Okafor" },
  { email: "carol@ajaia.test", name: "Carol Diaz" },
];

/** Thin wrapper so call sites read like a sync SQLite API: db.get / db.all / db.run. */
export class DB {
  constructor(readonly client: Client) {}
  async all<T>(sql: string, args: InArgs = []): Promise<T[]> {
    return (await this.client.execute({ sql, args })).rows as unknown as T[];
  }
  async get<T>(sql: string, args: InArgs = []): Promise<T | undefined> {
    return (await this.all<T>(sql, args))[0];
  }
  async run(sql: string, args: InArgs = []) {
    return this.client.execute({ sql, args });
  }
}

/**
 * url: ":memory:" (tests), "file:data/app.db" (local), or "libsql://<db>.turso.io" (prod, needs authToken).
 * Same SQLite dialect everywhere, so local dev needs no external service.
 */
export async function openDb(url: string, authToken?: string): Promise<DB> {
  if (url.startsWith("file:")) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  const db = new DB(createClient({ url, authToken }));
  await db.client.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id    INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id         TEXT PRIMARY KEY,
      owner_id   INTEGER NOT NULL REFERENCES users(id),
      title      TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      version    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

    CREATE TABLE IF NOT EXISTS document_shares (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL CHECK (role IN ('viewer','editor')),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (document_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id);
  `);
  for (const u of SEED_USERS) await db.run("INSERT OR IGNORE INTO users (email, name) VALUES (?, ?)", [u.email, u.name]);
  return db;
}
