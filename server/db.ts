import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type DB = DatabaseSync;

export const SEED_USERS = [
  { email: "alice@ajaia.test", name: "Alice Chen" },
  { email: "bob@ajaia.test", name: "Bob Okafor" },
  { email: "carol@ajaia.test", name: "Carol Diaz" },
];

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
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

  const insert = db.prepare("INSERT OR IGNORE INTO users (email, name) VALUES (?, ?)");
  for (const u of SEED_USERS) insert.run(u.email, u.name);
  return db;
}
