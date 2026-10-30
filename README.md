# Ajaia Docs — lightweight collaborative document editor

A small full-stack Google-Docs-style editor: create, format, rename and autosave documents, import files, and share with other users as **viewer** or **editor**.

- **Live app:** _LIVE_URL_ (Render free tier — first load after idle can take ~30 s to wake up)
- **Source:** https://github.com/Tayyab-Ali-786/ajaia-docs
- **Walkthrough video:** see `VIDEO_URL.txt`

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
| Rich text | Bold, italic, underline, strikethrough, Heading 1–3, bulleted and numbered lists, quotes, undo/redo. Markdown shortcuts work too (`# `, `- `, `1. `). |
| File import | **`.txt`, `.md`, `.docx` (max 2 MB)** → a new editable document, titled after the file name. Other types are rejected with a clear message. |
| Sharing | Owner shares by email as **viewer** (read-only) or **editor**, changes the role, or revokes access. The list separates **My documents** from **Shared with me** (with role + owner). |
| Persistence | Documents, formatting (stored as sanitized HTML) and shares are kept in SQLite (libSQL): a local file in dev, Turso in production. |
| Conflict safety | Every save carries a version number. If someone else saved first, you get a "Reload" prompt (HTTP 409) instead of silently overwriting their work. |
| Export | Download any document you can open as Markdown. |

## Run locally

Requires **Node 24** (Node 22.13+ should also work).

```bash
npm install
npm run build          # build the React client into dist/client
npm start              # http://localhost:3001  (SQLite file at data/app.db)
```

Dev mode with hot reload: `npm run dev:server` and `npm run dev:client` in two terminals → http://localhost:5173 (Vite proxies `/api` to :3001).

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `DATABASE_URL` | `file:data/app.db` | libSQL URL: local file, or `libsql://<db>.turso.io` |
| `DATABASE_AUTH_TOKEN` | — | Turso token (production only) |
| `SESSION_SECRET` | dev value | Signs the session cookie. **Set it in production.** |

## Tests

```bash
npm test         # 7 API tests (Vitest + Supertest, in-memory DB)
npm run e2e      # headless-Chrome UI run against a running server; writes docs/screenshots/
npm run typecheck
```

- **API tests** (`server/app.test.ts`) cover:
  - auth required
  - create → edit → reopen round-trip with formatting
  - the sharing path: no access → viewer (can't edit or reshare) → editor → revoked
  - stale-write 409
  - XSS sanitization
  - validation
  - `.md`/`.txt` import and rejection of unsupported types
- **E2E** (`e2e/ui.e2e.mjs`) drives the real UI as Alice and Bob:
  - formatting through the toolbar and shortcuts
  - rename, reload and persistence
  - share as viewer, import `.md`, rejected upload
  - Bob sees a read-only view

  `CHROME_PATH` overrides the browser path.

## Deploy (Render + Turso, both free)

1. Turso: create a database, then copy its URL and a token.
2. Render: **New → Blueprint** → this repo (it reads `render.yaml`). Set `DATABASE_URL` and `DATABASE_AUTH_TOKEN`; `SESSION_SECRET` is generated for you.

## Docs

- [`ARCHITECTURE.md`](ARCHITECTURE.md): design, priorities, tradeoffs
- [`AI_WORKFLOW.md`](AI_WORKFLOW.md): how AI was used, what I changed or rejected, how I verified it
- [`DECISIONS.md`](DECISIONS.md) and [`PROCESS.md`](PROCESS.md): the decision log and timestamped AI log kept while building
- [`SUBMISSION.md`](SUBMISSION.md): what's included, what works, what's incomplete
