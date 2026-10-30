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
  version: number; created_at: string; updated_at: string;
}

declare module "express-serve-static-core" {
  interface Request { user?: User }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MAX_TITLE = 200;
const MAX_CONTENT = 1_000_000; // ~1 MB of HTML

export interface AppOptions { sessionSecret: string; clientDir?: string }

export function createApp(db: DB, opts: AppOptions) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser(opts.sessionSecret));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  // ---- helpers ----------------------------------------------------------
  const getUser = (id: number) =>
    db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(id) as User | undefined;

  function requireUser(req: Request, _res: Response, next: NextFunction) {
    const uid = Number(req.signedCookies?.uid);
    const user = uid ? getUser(uid) : undefined;
    if (!user) return next(new HttpError(401, "Not signed in"));
    req.user = user;
    next();
  }

  /** Load a doc and the caller's role on it. Missing OR inaccessible -> 404 (don't leak existence). */
  function loadDoc(docId: string, userId: number): { doc: DocRow; role: Role } {
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(docId) as DocRow | undefined;
    if (doc) {
      if (doc.owner_id === userId) return { doc, role: "owner" };
      const share = db
        .prepare("SELECT role FROM document_shares WHERE document_id = ? AND user_id = ?")
        .get(docId, userId) as { role: Role } | undefined;
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

  function serializeDoc(doc: DocRow, role: Role) {
    const owner = getUser(doc.owner_id)!;
    const shares =
      role === "owner"
        ? db
            .prepare(
              `SELECT u.id, u.email, u.name, s.role FROM document_shares s
               JOIN users u ON u.id = s.user_id WHERE s.document_id = ? ORDER BY u.name`,
            )
            .all(doc.id)
        : [];
    return {
      id: doc.id, title: doc.title, content: doc.content, version: doc.version,
      createdAt: doc.created_at, updatedAt: doc.updated_at,
      owner, role, shares,
    };
  }

  function createDoc(ownerId: number, title: string, content: string) {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO documents (id, owner_id, title, content) VALUES (?, ?, ?, ?)").run(id, ownerId, title, content);
    return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as unknown as DocRow;
  }

  // ---- auth (mocked: pick a seeded user) --------------------------------
  const api = express.Router();

  api.get("/health", (_req, res) => { res.json({ ok: true }); });

  api.get("/users", (_req, res) => {
    res.json(db.prepare("SELECT id, email, name FROM users ORDER BY name").all());
  });

  api.post("/auth/login", (req, res) => {
    const user = getUser(Number(req.body?.userId));
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

  api.get("/documents", (req, res) => {
    const uid = req.user!.id;
    const owned = db
      .prepare("SELECT id, title, updated_at AS updatedAt FROM documents WHERE owner_id = ? ORDER BY updated_at DESC")
      .all(uid);
    const shared = db
      .prepare(
        `SELECT d.id, d.title, d.updated_at AS updatedAt, s.role, u.name AS ownerName
         FROM document_shares s JOIN documents d ON d.id = s.document_id JOIN users u ON u.id = d.owner_id
         WHERE s.user_id = ? ORDER BY d.updated_at DESC`,
      )
      .all(uid);
    res.json({ owned, shared });
  });

  api.post("/documents", (req, res) => {
    const title = req.body?.title === undefined ? "Untitled document" : validTitle(req.body.title);
    const content = req.body?.content === undefined ? "" : validContent(req.body.content);
    res.status(201).json(serializeDoc(createDoc(req.user!.id, title, content), "owner"));
  });

  api.post("/documents/import", upload.single("file"), async (req, res) => {
    if (!req.file) throw new HttpError(400, `No file uploaded. Supported: ${IMPORT_TYPES.join(", ")}`);
    const { title, html } = await importFile(req.file.originalname, req.file.buffer);
    res.status(201).json(serializeDoc(createDoc(req.user!.id, title, html), "owner"));
  });

  api.get("/documents/:id", (req, res) => {
    const { doc, role } = loadDoc(req.params.id, req.user!.id);
    res.json(serializeDoc(doc, role));
  });

  api.patch("/documents/:id", (req, res) => {
    const { doc, role } = loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner", "editor"]);
    const body = req.body ?? {};
    if (body.title === undefined && body.content === undefined) throw new HttpError(400, "Nothing to update");
    // Optimistic concurrency: reject stale writes instead of silently clobbering a collaborator.
    if (body.version !== undefined && body.version !== doc.version)
      throw new HttpError(409, "This document was changed by someone else. Reload to get the latest version.");

    const title = body.title === undefined ? doc.title : validTitle(body.title);
    const content = body.content === undefined ? doc.content : validContent(body.content);
    db.prepare(
      `UPDATE documents SET title = ?, content = ?, version = version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ).run(title, content, doc.id);
    res.json(serializeDoc(loadDoc(doc.id, req.user!.id).doc, role));
  });

  api.delete("/documents/:id", (req, res) => {
    const { doc, role } = loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner"]);
    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
    res.status(204).end();
  });

  api.get("/documents/:id/export", (req, res) => {
    const { doc } = loadDoc(req.params.id, req.user!.id);
    const format = req.query.format === "html" ? "html" : "md";
    const safeName = doc.title.replace(/[^\w\- ]+/g, "").trim() || "document";
    const body = format === "md" ? `# ${doc.title}\n\n${toMarkdown(doc.content)}\n` : doc.content;
    res.setHeader("Content-Type", format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${format}"`);
    res.send(body);
  });

  // ---- sharing ----------------------------------------------------------
  api.post("/documents/:id/shares", (req, res) => {
    const { doc, role } = loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner"]);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const shareRole = req.body?.role ?? "editor";
    if (!["viewer", "editor"].includes(shareRole)) throw new HttpError(400, "Role must be viewer or editor");
    const target = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;
    if (!target) throw new HttpError(404, `No user with email "${email}"`);
    if (target.id === doc.owner_id) throw new HttpError(400, "You already own this document");
    db.prepare(
      `INSERT INTO document_shares (document_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`,
    ).run(doc.id, target.id, shareRole);
    res.status(201).json(serializeDoc(doc, role).shares);
  });

  api.delete("/documents/:id/shares/:userId", (req, res) => {
    const { doc, role } = loadDoc(req.params.id, req.user!.id);
    requireRole(role, ["owner"]);
    db.prepare("DELETE FROM document_shares WHERE document_id = ? AND user_id = ?").run(doc.id, Number(req.params.userId));
    res.json(serializeDoc(doc, role).shares);
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
