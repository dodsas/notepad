import { createClient } from "@libsql/client";

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_TOKEN;

if (!url) {
  throw new Error("TURSO_URL environment variable is required");
}

export const db = createClient({ url, authToken });

// Create the schema on startup if it does not already exist.
export async function initSchema() {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS notebooks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS notes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        notebook_id INTEGER REFERENCES notebooks(id) ON DELETE SET NULL,
        title       TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        is_pinned   INTEGER NOT NULL DEFAULT 0,
        is_trashed  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS tags (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS note_tags (
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, tag_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_trashed ON notes(is_trashed)`,
    ],
    "write"
  );
}
