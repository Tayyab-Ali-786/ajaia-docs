# DECISIONS.md — Tradeoffs & Choices

Format: **Decision** — options considered → choice → why → what we gave up.

## Assumptions & Ambiguities
- **Users/auth:** Prompt allows mocked auth → seeded users + "sign in as" picker (session cookie). No passwords.
- **"Share with another user":** share by email of an existing (seeded) user; no invites for unknown emails.
- **Concurrency:** single-editor-at-a-time assumed; last-write-wins on save. No real-time co-editing.
- **Upload behavior:** import `.txt` / `.md` / `.docx` → new editable document. Max 2 MB. Other types rejected with clear message.
- **Persistence format:** store editor HTML (sanitized on server) — portable, preserves formatting, easy to export.
- **Deployment:** reviewers must not pay → free-to-access public URL; I host it.

## Decisions
1. **Stack** — Next.js vs Vite React + Express vs Go backend → **Vite React + Express (TypeScript) in one service** → fastest for me, one deploy unit, Express serves built SPA + API. Gave up SSR (not needed for an internal tool).
2. **DB** — Postgres/Supabase vs SQLite → **SQLite (on Railway volume)** → zero external services, real SQL + FKs, trivial local setup. Gave up horizontal scaling (fine for scope).
3. **Editor** — TipTap vs Quill vs Lexical vs Slate → **TipTap (ProseMirror)** → StarterKit covers bold/italic/headings/lists; underline is one extension; clean HTML I/O. Gave up nothing material.
4. **Deploy** — Vercel vs Render vs Railway → **Railway** (CLI already authenticated, supports persistent volume for SQLite). Vercel serverless can't keep a SQLite file.
5. **Roles** — basic access vs viewer/editor → **viewer/editor baked in from the start** (one column + one check); covers a stretch item cheaply.
6. **Real-time collaboration** — deliberately **skipped** (Yjs + websockets is a multi-hour rabbit hole with high risk); documented as next step.
