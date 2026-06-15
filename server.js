import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import { db, initSchema } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- helpers ---------------------------------------------------------------

const asyncRoute = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

// Attach the tag names of a set of notes in a single query.
async function attachTags(notes) {
  if (notes.length === 0) return notes;
  const ids = notes.map((n) => n.id);
  const placeholders = ids.map(() => "?").join(",");
  const { rows } = await db.execute({
    sql: `SELECT nt.note_id AS note_id, t.name AS name
          FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
          WHERE nt.note_id IN (${placeholders})`,
    args: ids,
  });
  const byNote = new Map();
  for (const r of rows) {
    if (!byNote.has(r.note_id)) byNote.set(r.note_id, []);
    byNote.get(r.note_id).push(r.name);
  }
  for (const n of notes) n.tags = byNote.get(n.id) || [];
  return notes;
}

// Replace the tag set of a note, creating tags as needed.
async function setNoteTags(noteId, tags) {
  await db.execute({ sql: `DELETE FROM note_tags WHERE note_id = ?`, args: [noteId] });
  const clean = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))];
  for (const name of clean) {
    await db.execute({
      sql: `INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING`,
      args: [name],
    });
    const { rows } = await db.execute({ sql: `SELECT id FROM tags WHERE name = ?`, args: [name] });
    await db.execute({
      sql: `INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
      args: [noteId, rows[0].id],
    });
  }
}

// ---- notebooks -------------------------------------------------------------

app.get(
  "/api/notebooks",
  asyncRoute(async (req, res) => {
    const { rows } = await db.execute(`
      SELECT nb.id, nb.name, nb.created_at,
             (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.is_trashed = 0) AS note_count
      FROM notebooks nb ORDER BY nb.name COLLATE NOCASE`);
    res.json(rows);
  })
);

app.post(
  "/api/notebooks",
  asyncRoute(async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const result = await db.execute({ sql: `INSERT INTO notebooks (name) VALUES (?)`, args: [name] });
    res.status(201).json({ id: Number(result.lastInsertRowid), name });
  })
);

app.put(
  "/api/notebooks/:id",
  asyncRoute(async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    await db.execute({ sql: `UPDATE notebooks SET name = ? WHERE id = ?`, args: [name, req.params.id] });
    res.json({ id: Number(req.params.id), name });
  })
);

app.delete(
  "/api/notebooks/:id",
  asyncRoute(async (req, res) => {
    // Notes keep existing but lose their notebook (ON DELETE SET NULL).
    await db.execute({ sql: `DELETE FROM notebooks WHERE id = ?`, args: [req.params.id] });
    res.json({ ok: true });
  })
);

// ---- tags ------------------------------------------------------------------

app.get(
  "/api/tags",
  asyncRoute(async (req, res) => {
    const { rows } = await db.execute(`
      SELECT t.name,
             (SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id
              WHERE nt.tag_id = t.id AND n.is_trashed = 0) AS note_count
      FROM tags t ORDER BY t.name COLLATE NOCASE`);
    res.json(rows.filter((r) => r.note_count > 0));
  })
);

// ---- notes -----------------------------------------------------------------

// List notes. Supports ?notebook=, ?tag=, ?q=, ?trashed=1
app.get(
  "/api/notes",
  asyncRoute(async (req, res) => {
    const { notebook, tag, q, trashed } = req.query;
    const where = [];
    const args = [];

    where.push(`n.is_trashed = ?`);
    args.push(trashed === "1" ? 1 : 0);

    if (notebook) {
      where.push(`n.notebook_id = ?`);
      args.push(notebook);
    }
    if (q) {
      where.push(`(n.title LIKE ? OR n.content LIKE ?)`);
      args.push(`%${q}%`, `%${q}%`);
    }
    if (tag) {
      where.push(`n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.name = ?)`);
      args.push(tag);
    }

    const { rows } = await db.execute({
      sql: `SELECT n.id, n.notebook_id, n.title, n.content, n.is_pinned, n.is_trashed,
                   n.created_at, n.updated_at
            FROM notes n
            WHERE ${where.join(" AND ")}
            ORDER BY n.is_pinned DESC, n.updated_at DESC`,
      args,
    });
    res.json(await attachTags(rows));
  })
);

app.get(
  "/api/notes/:id",
  asyncRoute(async (req, res) => {
    const { rows } = await db.execute({ sql: `SELECT * FROM notes WHERE id = ?`, args: [req.params.id] });
    if (rows.length === 0) return res.status(404).json({ error: "not found" });
    res.json((await attachTags(rows))[0]);
  })
);

app.post(
  "/api/notes",
  asyncRoute(async (req, res) => {
    const { title = "", content = "", notebook_id = null, tags = [] } = req.body;
    const result = await db.execute({
      sql: `INSERT INTO notes (title, content, notebook_id) VALUES (?, ?, ?)`,
      args: [title, content, notebook_id || null],
    });
    const id = Number(result.lastInsertRowid);
    await setNoteTags(id, tags);
    const { rows } = await db.execute({ sql: `SELECT * FROM notes WHERE id = ?`, args: [id] });
    res.status(201).json((await attachTags(rows))[0]);
  })
);

app.put(
  "/api/notes/:id",
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const fields = [];
    const args = [];
    for (const key of ["title", "content", "notebook_id", "is_pinned", "is_trashed"]) {
      if (key in req.body) {
        fields.push(`${key} = ?`);
        args.push(key === "notebook_id" ? req.body[key] || null : req.body[key]);
      }
    }
    fields.push(`updated_at = datetime('now')`);
    if (fields.length > 1) {
      args.push(id);
      await db.execute({ sql: `UPDATE notes SET ${fields.join(", ")} WHERE id = ?`, args });
    }
    if ("tags" in req.body) await setNoteTags(id, req.body.tags);
    const { rows } = await db.execute({ sql: `SELECT * FROM notes WHERE id = ?`, args: [id] });
    if (rows.length === 0) return res.status(404).json({ error: "not found" });
    res.json((await attachTags(rows))[0]);
  })
);

// Permanently delete a note.
app.delete(
  "/api/notes/:id",
  asyncRoute(async (req, res) => {
    await db.execute({ sql: `DELETE FROM notes WHERE id = ?`, args: [req.params.id] });
    res.json({ ok: true });
  })
);

// SPA fallback.
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Notepad running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
