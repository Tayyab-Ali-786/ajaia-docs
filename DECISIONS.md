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
2. **DB**: SQLite → libSQL/Turso → **Postgres on Supabase** (final). After the Railway trial expired, the first plan was Turso (no code changes). I switched to Supabase because I already have an account and a CLI, and it's a widely recognized managed Postgres. Tests and local dev use **PGlite** (WASM Postgres) so they run the same dialect with no install. Cost: a 15-minute SQL port.
3. **Editor** — TipTap vs Quill vs Lexical vs Slate → **TipTap v3** → StarterKit covers bold/italic/underline/headings/lists; clean HTML I/O.
4. **Deploy**: Railway (trial expired) vs Render+Turso vs Render ephemeral → **Render free + Supabase free**. Gave up: a ~30 s cold start after idle on Render free. Connects through the Supabase session pooler (the direct host is IPv6-only).
5. **Roles** — basic access vs viewer/editor → **viewer/editor from day one** (one column + one check); covers a stretch item cheaply.
6. **Real-time collaboration** — **deliberately skipped** (Yjs + websockets = multi-hour, high risk). Replaced with cheap, correct conflict detection (version column).
7. **Security baseline** — server-side HTML sanitization (allow-list matching editor output) on every write *and* import; 404 for inaccessible docs (no existence leak); signed cookies.
8. **Stretch picked**: roles + export to Markdown (cheap), then **version history** once the core was deployed and verified with about 3 hours to spare. Skipped comments and real-time collaboration.
9. **History granularity**: one entry per save (floods the list) vs. timed snapshots (needs a background job) vs. **merging same-user edits within 2 minutes** → readable history with a single conditional `UPDATE` and no jobs. `created` and `restore` entries are never merged.
10. **Auth**: the brief allows mocked users. Real auth was considered and **rejected** because a signup flow makes reviewers' sharing test harder, it isn't graded, and it adds risk to the demo late in the build.
