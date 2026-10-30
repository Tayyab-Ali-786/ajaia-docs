import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import type { DB } from "./db.ts";
import { sanitize, importFile, ImportError, MAX_UPLOAD_BYTES, toMarkdown, IMPORT_TYPES } from "./content.ts";

type Role = "owner" | "editor" | "viewer";
interface User { id: number; email: string; name: string }
interface DocRow {
  id: string; owner_id: number; title: string; content: string;
  version: number; created_at: Date; updated_at: Date;
}

declare module "express-serve-static-core" {
  interface Request { user?: User }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MAX_TITLE = 200;
const MAX_CONTENT = 1_000_000; // ~1 MB of HTML
const COALESCE_WINDOW = "2 minutes"; // same-user edits within this window share one history entry

export interface AppOptions { sessionSecret: string; clientDir?: string }

export function createApp(db: DB, opts: AppOptions) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser(opts.sessionSecret));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  // ---- helpers ----------------------------------------------------------
  const getUser = (id: number) => db.get<User>("SELECT id, email, name FROM users WHERE id = $1", [id]);

  async function requireUser(req: Request, _res: Response, next: NextFunction) {
    const uid = Number(req.signedCookies?.uid);
    const user = uid ? await getUser(uid) : undefined;
    if (!user) return next(new HttpError(401, "Not signed in"));
    req.user = user;
    next();
  }

  /** Load a doc and the caller's role on it. Missing OR inaccessible -> 404 (don't leak existence). */
  async function loadDoc(docId: string, userId: number): Promise<{ doc: DocRow; role: Role }> {
    const doc = await db.get<DocRow>("SELECT * FROM documents WHERE id = $1", [docId]);
    if (doc) {
      if (doc.owner_id === userId) return { doc, role: "owner" };
      const share = await db.get<{ role: Role }>(
        "SELECT role FROM document_shares WHERE document_id = $1 AND user_id = $2", [docId, userId]);
      if (share) return { doc, role: share.role };
    }
    throw new HttpError(404, "Document not found");
  }

  function requireRole(role: Role, allowed: Role[]) {
    if (!allowed.includes(role)) throw new HttpError(403, `This action requires ${allowed.join(" or ")} access`);
  }

  function validTitle(t: unknown): string {
    if (typeof t !== "string") throw new HttpError(400, "Title must be a string");
    const title = t.trim();
    if (!title) throw new HttpError(400, "Title cannot be empty");
    if (title.length > MAX_TITLE) throw new HttpError(400, `Title must be ≤ ${MAX_TITLE} characters`);
    return title;
  }

  function validContent(c: unknown): string {
    if (typeof c !== "string") throw new HttpError(400, "Content must be a string");
    if (c.length > MAX_CONTENT) throw new HttpError(413, "Document is too large");
    return sanitize(c);
  }

  const listShares = (docId: string) =>
    db.all(
      `SELECT u.id, u.email, u.name, s.role FROM document_shares s
       JOIN users u ON u.id = s.user_id WHERE s.document_id = $1 ORDER BY u.name`,
      [docId],
    );

  async function serializeDoc(doc: DocRow, role: Role) {
    const owner = (await getUser(doc.owner_id))!;
    const shares = role === "owner" ? await listShares(doc.id) : [];
    return {
      id: doc.id, title: doc.title, content: doc.content, version: doc.version,
      createdAt: doc.created_at, updatedAt: doc.updated_at,
      owner, role, shares,
    };
  }

  async function createDoc(ownerId: number, title: string, content: string) {
    const id = crypto.randomUUID();
    await db.run("INSERT INTO documents (id, owner_id, title, content) VALUES ($1, $2, $3, $4)", [id, ownerId, title, content]);
    const doc = (await db.get<DocRow>("SELECT * FROM documents WHERE id = $1", [id]))!;
    await recordVersion(doc, ownerId, "created");
    return doc;
  }

  /** Append a history entry, or fold an edit into the latest one if it's the same user's recent edit. */
  async function recordVersion(doc: DocRow, userId: number, kind: "created" | "edit" | "restore") {
    if (kind === "edit") {
      const folded = await db.run(
        `UPDATE document_versions SET version = $1, title = $2, content = $3, saved_at = now()
         WHERE id = (SELECT id FROM document_versions WHERE document_id = $4 ORDER BY id DESC LIMIT 1)
           AND kind = 'edit' AND created_by = $5 AND created_at > now() - $6::interval`,
        [doc.version, doc.title, doc.content, doc.id, userId, COALESCE_WINDOW],
      );
      if (folded) return;
    }
    await db.run(
      `INSERT INTO document_versions (document_id, version, title, content, kind, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [doc.id, doc.version, doc.title, doc.content, kind, userId],
    );
  }

  /** Version-checked write (optimistic concurrency) + history entry. */
  async function writeDoc(doc: DocRow, expected: number, title: string, content: string, userId: number, kind: "edit" | "restore") {
    const conflict = new HttpError(409, "This document was changed by someone else. Reload to get the latest version.");
    if (expected !== doc.version) throw conflict;
    // The version check lives in the WHERE clause so it's atomic even with concurrent requests.
    const updated = await db.run(
      `UPDATE documents SET title = $1, content = $2, version = version + 1, updated_at = now()
       WHERE id = $3 AND version = $4`,
      [title, content, doc.id, expected],
    );
    if (updated === 0) throw conflict;
    const saved = (await db.get<DocRow>("SELECT * FROM documents WHERE id = $1", [doc.id]))!;
    await recordVersion(saved, userId, kind);
    return saved;
  }

  // ---- auth (mocked: pick a seeded user) --------------------------------
  const api = express.Router();

  api.get("/health", (_req, res) => { res.json({ ok: true }); });

  api.get("/users", async (_req, res) => {
    res.json(await db.all("SELECT id, email, name FROM users ORDER BY name"));
  });

  api.post("/auth/login", async (req, res) => {
    const user = await getUser(Number(req.body?.userId));
    if (!user) throw new HttpError(400, "Unknown user");
    res.cookie("uid", String(user.id), {
      signed: true, httpOnly: true, sameSite: "lax",
      secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 3600 * 1000,
    });
    res.json(user);
  });

  api.post("/auth/logout", (_req, res) => { res.clearCookie("uid"); res.json({ ok: true }); });

  api.get("/auth/me", requireUser, (req, res) => { res.json(req.user); });

  // ---- documents --------------------------------------------------------
  api.use("/documents", requireUser);

  api.get("/documents", async (req, res) => {
    const uid = req.user!.id;
    const owned = await db.all(
      `SELECT id, title, updated_at AS "updatedAt" FROM documents WHERE owner_id = $1 ORDER BY updated_at DESC`, [uid]);
    const shared = await db.all(
      `SELECT d.id, d.title, d.updated_at AS "updatedAt", s.role, u.name AS "ownerName"
       FROM document_shares s JOIN documents d ON d.id = s.document_id JOIN users u ON u.id = d.owner_id
       WHERE s.user_id = $1 ORDER BY d.updated_at DESC`,
      [uid],
    );
    res.json({ owned, shared });
  });

  api.post("/documents", async (req, res) => {
    const title = req.body?.title === undefined ? "Untitled document" : validTitle(req.body.title);
    const content = req.body?.content === undefined ? "" : validContent(req.body.content);
    res.status(201).json(await serializeDoc(await createDoc(req.user!.id, title, content), "owner"));
  });

  api.post("/documents/import", upload.single("file"), async (req, res) => {
    if (!req.file) throw new HttpError(400, `No file uploaded. Supported: ${IMPORT_TYPES.join(", ")}`);
    const { title, html } = await importFile(req.file.originalname, req.file.buffer);
    res.status(201).json(await serializeDoc(await createDoc(req.user!.id, title, html), "owner"));
  });

  api.get("/documents/:id", async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user!.id);
    res.json(await serializeDoc(doc, role));
  });

  api.patch("/documents/:id", async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner", "editor"]);
    const body = req.body ?? {};
    if (body.title === undefined && body.content === undefined) throw new HttpError(400, "Nothing to update");
    // Optimistic concurrency: reject stale writes instead of silently clobbering a collaborator.
    const title = body.title === undefined ? doc.title : validTitle(body.title);
    const content = body.content === undefined ? doc.content : validContent(body.content);
    const saved = await writeDoc(doc, body.version ?? doc.version, title, content, req.user!.id, "edit");
    res.json(await serializeDoc(saved, role));
  });

  // ---- version history ---------------------------------------------------
  api.get("/documents/:id/versions", async (req, res) => {
    const { doc } = await loadDoc(req.params.id, req.user!.id);
    res.json(
      await db.all(
        `SELECT v.id, v.version, v.title, v.kind, v.saved_at AS "savedAt", u.name AS "authorName"
         FROM document_versions v JOIN users u ON u.id = v.created_by
         WHERE v.document_id = $1 ORDER BY v.id DESC LIMIT 100`,
        [doc.id],
      ),
    );
  });

  async function loadVersion(docId: string, versionId: string) {
    const v = await db.get<{ id: number; title: string; content: string; version: number }>(
      "SELECT id, title, content, version FROM document_versions WHERE id = $1 AND document_id = $2",
      [Number(versionId) || 0, docId],
    );
    if (!v) throw new HttpError(404, "Version not found");
    return v;
  }

  api.get("/documents/:id/versions/:versionId", async (req, res) => {
    const { doc } = await loadDoc(req.params.id, req.user!.id);
    res.json(await loadVersion(doc.id, req.params.versionId));
  });

  api.post("/documents/:id/versions/:versionId/restore", async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner", "editor"]);
    const v = await loadVersion(doc.id, req.params.versionId);
    // Restoring is itself a new version, so it can be undone from history too.
    const saved = await writeDoc(doc, req.body?.version ?? doc.version, v.title, v.content, req.user!.id, "restore");
    res.json(await serializeDoc(saved, role));
  });

  api.delete("/documents/:id", async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner"]);
    await db.run("DELETE FROM documents WHERE id = $1", [doc.id]); // shares cascade
    res.status(204).end();
  });

  api.get("/documents/:id/export", async (req, res) => {
    const { doc } = await loadDoc(req.params.id, req.user!.id);
    const format = req.query.format === "html" ? "html" : "md";
    const safeName = doc.title.replace(/[^\w\- ]+/g, "").trim() || "document";
    const body = format === "md" ? `# ${doc.title}\n\n${toMarkdown(doc.content)}\n` : doc.content;
    res.setHeader("Content-Type", format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${format}"`);
    res.send(body);
  });

  // ---- sharing ----------------------------------------------------------
  api.post("/documents/:id/shares", async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner"]);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const shareRole = req.body?.role ?? "editor";
    if (!["viewer", "editor"].includes(shareRole)) throw new HttpError(400, "Role must be viewer or editor");
    const target = await db.get<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]);
    if (!target) throw new HttpError(404, `No user with email "${email}"`);
    if (target.id === doc.owner_id) throw new HttpError(400, "You already own this document");
    await db.run(
      `INSERT INTO document_shares (document_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`,
      [doc.id, target.id, shareRole],
    );
    res.status(201).json(await listShares(doc.id));
  });

  api.delete("/documents/:id/shares/:userId", async (req, res) => {
    const { doc, role } = await loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner"]);
    await db.run("DELETE FROM document_shares WHERE document_id = $1 AND user_id = $2", [doc.id, Number(req.params.userId)]);
    res.json(await listShares(doc.id));
  });

  app.use("/api", api);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  // ---- static SPA (production) -----------------------------------------
  if (opts.clientDir && fs.existsSync(opts.clientDir)) {
    app.use(express.static(opts.clientDir));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(opts.clientDir!, "index.html")));
  }

  // ---- errors -----------------------------------------------------------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ImportError) return void res.status(400).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` : err.message;
      return void res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg });
    }
    if (err instanceof SyntaxError && "body" in err) return void res.status(400).json({ error: "Invalid JSON" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}
