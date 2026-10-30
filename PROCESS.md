# PROCESS.md — AI Usage Log

Running log of key prompts, what AI produced, and what I kept / changed / rejected (and why).
Tool: Claude Code (CLI agent, Claude Opus) as pair programmer in the repo + terminal.

| # | Time | Prompt (summary) | AI output | Kept / Changed / Rejected | Why |
|---|------|------------------|-----------|---------------------------|-----|
| 0 | 15:59 | Set up workspace, process log, decisions log | Scaffolding files | Kept | Establish logging habit before work starts |
| 1 | 16:00 | "Explain the problem, gather info, research, then plan" (pasted full brief) | Problem breakdown, env check (node 24, railway CLI, gh), stack options, timeboxed plan, traps (real-time collab, deploy risk, video time) | Kept | Plan before code; tooling verified so deploy choice is grounded in what's actually installed |
| 2 | 16:05 | "go" — scaffold + backend | Express API, SQLite schema, mocked auth, access-control helper, import pipeline, sanitizer | Kept, with AI-proposed refinements I accepted: 404 (not 403) for docs you can't see; optimistic-concurrency `version` column | 404 avoids leaking document existence; `version` prevents two editors silently overwriting each other |
| 3 | 16:10 | Tests for access control | 7 Vitest+Supertest tests (auth, CRUD round-trip, viewer/editor/revoke, 409 stale write, XSS sanitize, validation, import) | Kept — all green first run | Tests target the riskiest logic (permissions) not trivia |
| 4 | 16:12 | Frontend | React + TipTap editor, toolbar, autosave queue, share dialog, list w/ owned vs shared | Kept; dropped `@tiptap/extension-underline` after checking TipTap v3 StarterKit already bundles Underline | Verified in `node_modules` types instead of trusting the AI's first install list |
| 5 | 16:15 | Deploy to Railway | CLI commands | **Failure, caught & reported:** `railway init` errored (multiple workspaces) and subsequent commands silently used a different project linked from a parent directory | Lesson: verify `railway status` before mutating commands. Stopped, reported to me, asked before any cleanup |
| 6 | 16:17 | Railway trial expired → choose alternative | Options w/ tradeoffs (pay / Render+Turso / ephemeral SQLite) | Chose Render + Turso (free, real persistence) | Brief forbids reviewer cost, not author cost — but free path keeps it simple to hand over |
| 7 | 16:18 | Swap `node:sqlite` → `@libsql/client` | Thin `DB` wrapper (`get/all/run`) + scripted mechanical refactor of call sites | Kept; AI also moved version check into `UPDATE … WHERE version = ?` and added explicit share cleanup on delete | Atomic concurrency check; remote libSQL doesn't guarantee `PRAGMA foreign_keys` per connection |
| 8 | 16:30 | "Verify the UI in a real browser" | Chrome extension tools unavailable → AI found local `google-chrome`, wrote a 2-user puppeteer-core E2E (11 checks) + screenshots | Kept, committed as `npm run e2e` | Tests the real UI, not just the API |
| 9 | 16:33 | Investigate E2E failures | (a) "rename not persisted" → stored title `Untitled documenQ4 Launch Plant` proved a **test** bug (triple-click didn't select); (b) import timeout → transient | Fixed the test, not the app | Read the data before "fixing" code |
| 10 | 16:35 | Review screenshots | Spotted default-blue export link, loose list spacing, missing Delete button in UI | Fixed all three | Visual review catches what assertions don't |
| 11 | 16:37 | Draft README / ARCHITECTURE / AI_WORKFLOW / SUBMISSION | Drafts | Kept; trimmed | Concise, reviewer-first structure |
