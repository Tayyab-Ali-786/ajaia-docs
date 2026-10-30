# Submission: Ajaia Docs
**Tayyab Ali Rashid · Full Stack Product Engineer · AI-Native Assessment**

## Overview

Ajaia Docs is a lightweight collaborative document editor:
- create, format and autosave documents
- import `.txt` / `.md` / `.docx` files
- share with other users as **viewer** or **editor**
- browse and restore version history

| | |
|---|---|
| **Live app** | https://ajaia-docs-mpvh.onrender.com. Free tier: after about 15 minutes idle, the first load takes **about 30–50 s** to wake up. |
| **Repo** | https://github.com/Tayyab-Ali-786/ajaia-docs (the same source is in this folder) |
| **Video** | `VIDEO_URL.txt` |
| **Test accounts** | No password; pick one on the login screen: `alice@ajaia.test`, `bob@ajaia.test`, `carol@ajaia.test` |
| **Try sharing** | Alice in one window, Bob in an incognito window. Alice: **Share** → `bob@ajaia.test` → *Can view*. Bob sees it under **Shared with me**. |

## Approach & Plan

1. **Plan before code.** I broke down the brief, listed the ambiguities, and identified the traps: real-time collaboration as a rabbit hole, deployment as the biggest risk, and the video taking real time. I set a timed plan with a 30-minute buffer ([`DECISIONS.md`](DECISIONS.md)).
2. **Build the core in verified slices:** API + permission tests → editor UI → two-user browser E2E → deploy early → documentation.
3. **Optional extras only after the core was live and verified in production:** roles, Markdown export, version history.
4. **Feature freeze, then a review pass** for edge cases and query cost. The final verification ran against production.

## What I Built (mapped to the brief)

| Brief requirement | Delivered |
|---|---|
| Create, rename, edit, save, reopen | ✅ Autosave about 0.8 s after typing stops, `Ctrl/Cmd+S`, visible save status, click the title to rename, owner can delete |
| Bold / italic / underline | ✅ Plus strikethrough and quotes |
| Headings or text size | ✅ H1–H3 (style dropdown and `#` shortcuts), plus text alignment |
| Bulleted / numbered lists | ✅ Toolbar and `-` / `1.` shortcuts |
| File upload in the product workflow | ✅ **Import `.txt` / `.md` / `.docx` (≤ 2 MB) as a new editable document.** The supported types are stated in the UI and README; other types get a clear error |
| Owner, grant access, owned vs shared shown differently | ✅ Share by email as viewer or editor, change roles, revoke. Separate **My documents** and **Shared with me** sections with role and owner badges |
| Simulated users are fine | ✅ Three seeded users and a "sign in as" picker. The permission checks underneath are real and enforced by the server |
| Persistence after refresh, formatting kept, sharing demonstrable | ✅ Postgres on Supabase; formatting stored as sanitized HTML |
| Setup instructions | ✅ [`README.md`](README.md); checked with a fresh clone (`npm install && npm run build && npm start`, no database install) |
| Working deployment | ✅ Render + Supabase, both free, so reviewers pay nothing |
| Validation and error handling | ✅ Server-side validation (titles, versions, sizes, types, roles); clear UI errors; save failures sorted into stop / retry-after-edit / retry automatically |
| At least one meaningful test | ✅ 9 API tests + an 18-check two-user browser E2E run (see Testing) |
| Architecture note | ✅ [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| AI workflow note | ✅ [`AI_WORKFLOW.md`](AI_WORKFLOW.md), with the timestamped log in [`PROCESS.md`](PROCESS.md) |
| Optional extra (pick one) | ✅ Three: **viewer/editor roles**, **Markdown export**, **version history** (preview + restore, and a restore can be undone) |
| Walkthrough video | ✅ `VIDEO_URL.txt` |

## Key Decisions & Tradeoffs

Full log: [`DECISIONS.md`](DECISIONS.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

- **One service:** Express serves the API and the built React app. One deploy, no CORS, and local setup is one command.
- **Real-time co-editing was deliberately skipped.** Yjs plus WebSockets is several hours of work with high risk. Instead, **optimistic concurrency** (`UPDATE … WHERE version = ?`) means a stale save gets a 409 and a "Reload" prompt, so collaborators' work is never silently overwritten.
- **No access returns 404, not 403**, so the API never reveals which documents exist. Every permission check goes through one function, `loadDoc`.
- **Content is stored as sanitized HTML** with an allow-list that matches what the editor can produce. It runs on every write and every import, so no stored XSS.
- **Postgres everywhere:** Supabase in production, and **PGlite** (Postgres in WASM) for tests and local dev. Tests run the same SQL as production, and local setup needs no database.
- **Mocked auth was kept.** The brief allows it, real auth would make reviewers' sharing test harder, and it isn't graded.
- **Version history merges a user's saves within 2 minutes** into one entry, so the list stays readable without a background job.

## AI Usage & Process

I used Claude Code as a pair programmer. Every prompt and outcome is logged in [`PROCESS.md`](PROCESS.md); the reflection is in [`AI_WORKFLOW.md`](AI_WORKFLOW.md).

Best moments:
1. **I caught:** by testing manually, I saw "Save failed" flickering. The AI's first autosave retried every failure forever. The fix sorts failures into groups, and the new test for it **found two more loops** (`setEditable` firing an update event, and toolbar buttons remounting on every render).
2. **The AI caught:** in a review pass, it found that "Switch user" right after typing lost the edit. To show the new test can actually fail, I **put the old code back and confirmed the test failed**.
3. **Reading the data before fixing code:** an E2E failure saying "rename not persisted" was a bug in the test (the stored title was `Untitled documenQ4 Launch Plant`), so I fixed the test, not the app.
4. **A process lesson:** a deploy CLI fell back to a project linked from a parent directory. It was caught before any deploy, and from then on every infrastructure command named its target explicitly (`--org-id`, a confirmed workspace).

## Testing

```bash
npm test          # 9 API tests, in-memory Postgres (PGlite), about 5 s
npm run typecheck
npm start         # then, in another terminal:
npm run e2e       # 18-check two-user headless-Chrome run; writes docs/screenshots/
```

- **API tests:**
  - auth
  - the formatting round-trip
  - the full sharing path: none → viewer (can't edit or reshare) → editor → revoked
  - 409 on stale saves
  - version history and its permissions
  - XSS sanitization
  - validation
  - import
  - edge cases: malformed versions, non-ASCII export names, imports that are too large once converted
- **E2E checks:**
  - formatting and alignment survive a reload
  - rename
  - share as viewer, then Bob's view is read-only
  - restore from history, and undo the restore
  - import and rejected uploads
  - no retry loop after the document is deleted
  - no lost edit on "Switch user"
- **The E2E run was also run against the live URL** as the final check. The test data was deleted afterwards.

## Limitations & What I'd Do With More Time

**Limitations:**
- Auth is mocked; there are no passwords.
- No real-time co-editing; two people editing at once get a conflict prompt.
- `.docx` import keeps structure and basic formatting; images and tables are dropped. Images aren't supported in the editor (pasting one shows a notice).
- Render's free tier cold start is about 30–50 s.

**With another 2–4 hours:**
1. Real-time co-editing (Yjs plus a small WebSocket server) with presence avatars and cursors, replacing the conflict prompt.
2. Real authentication (magic link or OAuth) and inviting people who don't have an account yet.
3. Comments anchored to text ranges.
4. A side-by-side diff between versions in the history panel.

## What's in this folder

| Path | Contents |
|---|---|
| `SUBMISSION.md` | This file |
| `README.md` | Setup, run, test and deploy instructions; test accounts |
| `ARCHITECTURE.md` | Architecture note |
| `AI_WORKFLOW.md` | AI workflow note |
| `PROCESS.md` / `DECISIONS.md` | AI usage log and decision log |
| `VIDEO_URL.txt` | Walkthrough video link |
| `docs/screenshots/` | 8 screenshots of the main flows (generated by the E2E run) |
| `server/`, `client/`, `e2e/` | Source: API and tests, React app, browser E2E |
| `.env.example`, `render.yaml` | Configuration template and deployment blueprint |
