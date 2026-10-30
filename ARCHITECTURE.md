# Architecture Note

## Shape

```
Browser (React 19 + TipTap v3)
   │  fetch /api/*  (signed httpOnly session cookie)
   ▼
Express 5 (TypeScript, one Node service)
   ├─ /api/auth/*        mocked sign-in as a seeded user
   ├─ /api/documents/*   CRUD, import (multer → mammoth/marked → sanitize), export (turndown)
   ├─ /api/documents/:id/shares   owner-only grant / change role / revoke
   └─ serves the built SPA from dist/client
   ▼
Postgres: Supabase in production (pg pool) · PGlite (embedded WASM Postgres) locally and in tests
```

One deployable unit: the API and the frontend ship together, there's no CORS, and local setup is one `npm start`.

## Data model

```
users(id, email UNIQUE, name)
documents(id uuid, owner_id → users, title, content HTML, version, created_at, updated_at)
document_shares(document_id, user_id, role ∈ {viewer, editor}, PK(document_id, user_id))
document_versions(id, document_id, version, title, content, kind ∈ {created, edit, restore}, created_by, created_at, saved_at)
```

Ownership is a column, not a share row. So "owned" and "shared with me" are two simple queries, and an owner can never be downgraded by mistake.

## Access control (where I spent the most care)

All permission logic goes through one function, `loadDoc(docId, userId) → { doc, role }`, plus `requireRole(role, allowed)`.

- **No access returns 404, not 403.** Someone without access can't even tell the document exists.
- **Viewers** can read and export. **Editors** can also save. Only the **owner** can share, revoke or delete.
- The API enforces all of this. The UI only reflects it (no toolbar and a read-only editor for viewers).

## Editing and persistence

- **Storage format: HTML.** TipTap reads and writes it directly, it keeps all the formatting, and it's portable for import and export. The server sanitizes it against an allow-list that matches what the editor can produce. This runs on every write and every import, so a crafted API call or uploaded file can't store a script.
- **Autosave:**
  - The client groups edits together and sends them about 0.8 s after typing stops.
  - Only one save request is in flight at a time.
  - It flushes when you leave the page and warns before you close the tab with unsaved changes.
- **Optimistic concurrency.** `UPDATE … WHERE id = ? AND version = ?` makes the version check and the write a single atomic step. If another editor saved in between, the API returns 409 and the UI says "changed by someone else — Reload". That's the cheap, correct alternative to real-time merging (CRDTs).

## Version history

- **Every successful save adds a history entry**, written alongside the version-checked update.
- **Autosave would flood the list,** so an `edit` by the same user within 2 minutes of their latest `edit` entry updates that entry instead (a single conditional `UPDATE`). `created` and `restore` entries are never merged into.
- **Restore** goes through the same version-checked write, as a `restore` entry. That makes it conflict-safe, and it can itself be undone.
- **Permissions:** viewers can browse; restoring needs editor or owner.

## File import

`.txt` and `.md` convert directly, and `.docx` goes through `mammoth`. All three produce a new document. The limit is 2 MB and anything else is rejected, and the supported types are listed in the UI. Importing as a new document was the flow most useful to a product user ("bring my existing notes in") and the least ambiguous one.

## What I prioritized, and why

1. **Correct sharing and permissions.** This is the part that's dangerous to get wrong in a real product, so it has the most tests.
2. **An editor that feels solid.** Autosave with a visible status, a toolbar that shows what's active, markdown shortcuts, and no lost work (conflict detection and the unload warning).
3. **Shipping something they can test.** It was deployed early, it's one service, and both hosting tiers are free.

## Deliberately not built

| Cut | Why |
|---|---|
| Real-time co-editing (Yjs + WebSockets) and presence | Several hours of work with high risk. Version-based conflict detection covers the important part (no silent data loss). |
| Real auth (passwords, OAuth) | The brief allows mocked users, and the access-control logic underneath is real. |
| Comments, attachments | Optional extras. I picked **viewer/editor roles**, **export to Markdown** and **version history** because each was cheap, low-risk and worth having. |
| Pagination, search | Not needed at this data size. |

## Tradeoffs worth knowing

- **Render free tier** goes to sleep when idle, so the first request takes about 30 s.
- **PGlite for tests and local dev** runs the same Postgres engine as production, so tests check the real SQL (placeholders, `ON CONFLICT`, cascades) and running locally doesn't need a database install.
- **Supabase's direct database host is IPv6-only.** Production connects through the session pooler (IPv4).
- The mocked session cookie stores only the user id. It's signed (it can't be forged), but it's not a production-grade session. Replacing it with real auth only touches `requireUser`.
