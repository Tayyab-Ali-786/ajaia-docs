# Ajaia Docs: a lightweight collaborative document editor

A small full-stack Google-Docs-style editor: create, format, rename and autosave documents, import files, and share with other users as **viewer** or **editor**.

- **Live app:** https://ajaia-docs-mpvh.onrender.com (Render free tier: after about 15 minutes idle, the first load takes **about 30–50 s** to wake up)
- **Source:** https://github.com/Tayyab-Ali-786/ajaia-docs
- **Walkthrough video:** https://www.loom.com/share/f6610bc47d724d20aa8f399c989ce037

## Test accounts

Sign-in is mocked: pick a seeded user on the login screen (no password).

| User | Email |
|---|---|
| Alice Chen | alice@ajaia.test |
| Bob Okafor | bob@ajaia.test |
| Carol Diaz | carol@ajaia.test |

**To try sharing:** sign in as Alice in one browser window, and as Bob in a **second browser or an incognito window** (the session is a per-browser cookie). Alice creates a doc → **Share** → `bob@ajaia.test` → *Can view* or *Can edit*. Bob sees it under **Shared with me**.

## Features

| Area | What works |
|---|---|
| Documents | Create, rename (click the title), edit, reopen, delete (owner only). Autosave ~0.8 s after you stop typing, plus `Ctrl/Cmd+S`. Save status is shown ("Saving… / All changes saved"). |
| Rich text | Bold, italic, underline, strikethrough, Heading 1–3, text alignment (left, center, right, justify), bulleted and numbered lists, quotes, undo/redo. Markdown shortcuts work too (`# `, `- `, `1. `). Pasted images are rejected with a clear message (images are out of scope). |
| File import | **`.txt`, `.md`, `.docx` (max 2 MB)** → a new editable document, titled after the file name. Other types are rejected with a clear message. |
| Sharing | Owner shares by email as **viewer** (read-only) or **editor**, changes the role, or revokes access. The list separates **My documents** from **Shared with me** (with role + owner). |
| Persistence | Documents, formatting (stored as sanitized HTML) and shares are kept in Postgres: Supabase in production, embedded PGlite (Postgres compiled to WASM) locally and in tests. |
| Save safety | Every save carries a version number. If someone else saved first, you get a "Reload" prompt (HTTP 409) instead of silently overwriting their work. If the document is deleted or your access is removed while it's open, saving stops and the editor locks with a clear message. Network errors keep your edits in the tab and retry with increasing delays. |
| Version history | **History** lists saved versions with the author and time, previews any of them, and lets editors or owners restore one. A restore is itself a new version, so it can be undone. Quick autosaves by the same person within 2 minutes merge into one entry. |
| Export | Download any document you can open as Markdown. |

## Run locally

Requires **Node 24** (Node 22.13+ should also work).

```bash
npm install
npm run build          # build the React client into dist/client
npm start              # http://localhost:3001  (embedded Postgres in data/pgdata, no DB install needed)
```

Dev mode with hot reload: `npm run dev:server` and `npm run dev:client` in two terminals → http://localhost:5173 (Vite proxies `/api` to :3001).

Configuration is optional; every value has a working local default. To override one, `cp .env.example .env` and edit it. `.env` is loaded automatically and is git-ignored.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `DATABASE_URL` | `data/pgdata` | `postgresql://…` (e.g. Supabase) uses a pg pool. Anything else is an embedded PGlite path (`memory://` for tests). |
| `SESSION_SECRET` | dev value | Signs the session cookie. **Set it in production.** |

## Tests

```bash
npm test         # 9 API tests (Vitest + Supertest, in-memory PGlite Postgres)
npm run e2e      # headless-Chrome UI run against a running server (npm start in another terminal); writes docs/screenshots/
npm run e2e -- https://ajaia-docs-mpvh.onrender.com /tmp/shots   # same run against any URL
npm run typecheck
```

- **API tests** (`server/app.test.ts`) cover:
  - auth required
  - create → edit → reopen round-trip with formatting
  - the sharing path: no access → viewer (can't edit or reshare) → editor → revoked
  - stale-write 409
  - version history: merging of quick saves, viewers can browse but not restore, restore, stale restore
  - XSS sanitization
  - validation
  - `.md`/`.txt` import and rejection of unsupported types
  - edge cases: malformed versions, empty or owner email, non-ASCII export file names, imports that grow past the size limit once converted
- **E2E** (`e2e/ui.e2e.mjs`) drives the real UI as Alice and Bob:
  - formatting through the toolbar and shortcuts
  - rename, reload and persistence
  - share as viewer, restore from version history and undo the restore, import `.md`, rejected upload
  - Bob sees a read-only view, and can browse history but not restore
  - text alignment persists, a document deleted while open stops saving after one request (no retry loop), and "Switch user" right after typing doesn't lose the edit

  The E2E run needs a local Chrome or Chromium (default `/usr/bin/google-chrome`; set `CHROME_PATH` to override). It creates documents, so run it against a fresh database.

## Deploy (Render + Supabase, both free)

1. Supabase: create a project, then copy the **session pooler** connection string (Connect → Session pooler; it's IPv4-compatible, which Render needs). The tables and seed users are created on boot.
2. Render: **New → Blueprint** → this repo (it reads `render.yaml`). Set `DATABASE_URL`; `SESSION_SECRET` is generated for you.

## Docs

- [`ARCHITECTURE.md`](ARCHITECTURE.md): design, priorities, tradeoffs
- [`AI_WORKFLOW.md`](AI_WORKFLOW.md): how AI was used, what I changed or rejected, how I verified it
- [`DECISIONS.md`](DECISIONS.md) and [`PROCESS.md`](PROCESS.md): the decision log and timestamped AI log kept while building
- [`SUBMISSION.md`](SUBMISSION.md): what's included, what works, what's incomplete
