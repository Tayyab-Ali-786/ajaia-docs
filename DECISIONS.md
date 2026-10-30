# DECISIONS.md — Tradeoffs & Choices

Format: **Decision** — options considered → choice → why → what we gave up.

## Assumptions & Ambiguities
- **Users/auth:** Prompt allows mocked auth → seeded users + "sign in as" picker (signed httpOnly cookie). No passwords.
- **"Share with another user":** share by email of an existing (seeded) user; no invites for unknown emails.
- **Concurrency:** no real-time co-editing. Optimistic concurrency: stale saves get `409` + "Reload" prompt instead of silent last-write-wins.
- **Upload behavior:** import `.txt` / `.md` / `.docx` → new editable document. Max 2 MB. Other types rejected with a clear message.
- **Persistence format:** sanitized HTML — portable, preserves formatting, trivially exportable.
- **Deployment:** reviewers must not pay → free public URL.

## Decisions
1. **Stack** — Next.js vs Vite React + Express vs Go → **Vite React + Express (TS), one service** → fastest for me, one deploy unit, Express serves the SPA + API. Gave up SSR (not needed for an internal tool).
2. **DB** — Postgres/Supabase vs SQLite → **SQLite dialect via libSQL**: local file in dev/tests (zero setup), **Turso** in prod. Same SQL everywhere. Gave up rich Postgres features (not needed).
3. **Editor** — TipTap vs Quill vs Lexical vs Slate → **TipTap v3** → StarterKit covers bold/italic/underline/headings/lists; clean HTML I/O.
4. **Deploy** — Railway (trial expired) vs Render+Turso vs Render ephemeral → **Render free + Turso free**. Gave up: ~30s cold start after idle on Render free.
5. **Roles** — basic access vs viewer/editor → **viewer/editor from day one** (one column + one check); covers a stretch item cheaply.
6. **Real-time collaboration** — **deliberately skipped** (Yjs + websockets = multi-hour, high risk). Replaced with cheap, correct conflict detection (version column).
7. **Security baseline** — server-side HTML sanitization (allow-list matching editor output) on every write *and* import; 404 for inaccessible docs (no existence leak); signed cookies.
8. **Stretch picked** — Export to Markdown (≈15 min, high reviewer value) + roles. Skipped version history/comments.
