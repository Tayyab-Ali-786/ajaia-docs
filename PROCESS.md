# PROCESS.md: AI Usage Log

## Summary

| | |
|---|---|
| **Total time** | About 1 h 12 min to feature freeze (T+0:00 = 15:59), then finalizing |
| **Final stack** | React 19 + TipTap v3 · Express 5 (TypeScript) · Postgres (Supabase in production, PGlite in tests and local dev) · Render |
| **Tests** | 9 API tests (Vitest + Supertest) · 18-check, two-user, headless-Chrome E2E run, also run against production |
| **Live** | https://ajaia-docs-mpvh.onrender.com · repo: https://github.com/Tayyab-Ali-786/ajaia-docs |
| **Tool** | Claude Code (CLI agent, Claude Opus) as a pair programmer in the repo and terminal |

**Top moments:**
1. **I caught:** by testing manually, I saw "Save failed" flickering. The AI's first autosave retried *every* failure every 0.8 s, even errors that can never succeed (#20).
2. **The AI caught:** in a dedicated review pass, it found that "Switch user" right after typing lost the edit. I made sure the new test can fail: with the old code restored it fails, and with the fix it passes (#22).
3. **Reading the data before fixing:** a "rename not persisted" E2E failure turned out to be a bug in the test, not the app. The stored title was `Untitled documenQ4 Launch Plant` (#9).

Columns: what I asked → what the AI produced → what I kept, changed or rejected, and why. Times are checked against `git log`.

| # | T+ | Prompt (summary) | AI output | Kept / Changed / Rejected | Why |
|---|---|---|---|---|---|
| 0 | 0:00 | Set up a process log and a decisions log | Scaffolding files | Kept | Start the logging habit before any work |
| 1 | 0:01 | "Explain the problem, gather info, then plan" (full brief pasted) | Breakdown, environment check (Node, deploy CLIs), stack options, timed plan, traps (real-time scope, deploy risk, video time) | Kept | Plan before code; base the stack on the tools actually installed |
| 2 | 0:06 | "go": scaffold and backend | Express API, schema, mocked auth, one access-control helper, import pipeline, sanitizer | Kept, plus 404 (not 403) for hidden docs and a `version` column | Don't leak which documents exist; never silently overwrite a collaborator |
| 3 | 0:11 | Tests for access control | 7 API tests: auth, round-trip, viewer/editor/revoke, 409, XSS, validation, import | Kept; all passed on the first run | Test the riskiest logic (permissions), not trivia |
| 4 | 0:13 | Frontend | React + TipTap editor, toolbar, autosave queue, share dialog, owned vs shared lists | Changed: removed `@tiptap/extension-underline` | Checked the installed types: TipTap v3's StarterKit already includes it |
| 5 | 0:16 | Deploy to Railway | CLI commands | **Failure, caught:** `railway init` failed (multiple workspaces), and the commands that followed used a different project linked from a parent directory. Caught before any deploy: one empty service and volume were created there, with no changes to existing resources. Flagged for removal by an admin | From then on: check the target (`railway status` / explicit IDs) before running anything that changes state |
| 6 | 0:18 | The Railway trial had expired; pick an alternative | Options with tradeoffs (paid tier / Render + Turso / ephemeral SQLite) | Chose free hosting with real persistence | Reviewers must never pay; keep the handover simple |
| 7 | 0:21 | Move `node:sqlite` to libSQL | Thin `DB` wrapper plus a scripted refactor; atomic `UPDATE … WHERE version = ?` | Kept | The concurrency check and the write happen in one SQL statement |
| 8 | 0:34 | "Verify the UI in a real browser" | Found the local Chrome; two-user puppeteer-core E2E with screenshots | Kept as `npm run e2e` | Tests the real UI, not just the API |
| 9 | 0:36 | Investigate E2E failures | "Rename not persisted" turned out to be a **test** bug (the click didn't select the existing text) | Fixed the test, not the app | Read the data before "fixing" code |
| 10 | 0:37 | Review the screenshots | Link color, list spacing, missing Delete button | Fixed all three | Looking at the pixels catches what assertions don't |
| 11 | 0:39 | Draft README / ARCHITECTURE / AI_WORKFLOW / SUBMISSION | Drafts | Kept; trimmed | Written for reviewers first |
| 12 | 0:41 | Switch to Supabase | Created a dedicated Supabase project with an explicit `--org-id` to avoid CLI defaults | Kept | Name the target explicitly (the lesson from #5) |
| 13 | 0:43 | Port to Postgres | `pg` pool in production, PGlite in tests and local dev; `$n` placeholders; quoted camelCase aliases | Kept; tests stayed green | Same SQL dialect everywhere; local dev needs no install |
| 14 | 0:44 | Connect to Supabase | Direct host is IPv6-only, so it used the IPv4 session pooler | Kept | Render can't reach IPv6; the database password stays in a local file |
| 15 | 0:45 | E2E against Supabase | One failure: a test timing issue (the list still said "Loading…") | Fixed the wait condition | Network latency exposed an assumption in the test |
| 16 | 0:47 | Deploy to Render | Confirmed the Render workspace, created the service with env vars from a local file | Kept | Secrets never appear in the chat or the repo |
| 17 | 0:49 | Verify production | Full E2E against the live URL; deleted the test data | Kept | Verify the thing reviewers will actually use |
| 18 | 0:51 | "Is a proper auth flow required?" | Quoted the brief (mocked auth allowed); advised against building it | Agreed | A signup flow makes reviewers' testing harder, isn't graded, and adds late risk |
| 19 | 0:58 | Build version history | Merging of quick saves, restore as a new version, history panel; +1 API test, +4 E2E checks | Kept | A restore can be undone and is conflict-safe |
| 20 | 1:06 | Manual test: flickering "Save failed"; asked for text alignment | Retry loop fixed (failures classified, editor locked on 404/403); image-paste notice; alignment | Kept | Found by hand; details in ARCHITECTURE.md › Save failures |
| 21 | 1:06 | New E2E checks for those fixes | They found 2 more bugs: `setEditable` caused another save loop, and the toolbar remounted on every render | Both fixed | Writing the reproduction test before trusting the fix paid off twice |
| 22 | 1:11 | "Review again: optimizations and edge cases" | 8 edge cases fixed, about 6 → 4 database round trips per save, 1 optimization rejected | Kept; checked that the new test fails on the old code | Details in AI_WORKFLOW.md and ARCHITECTURE.md › Performance |

## Finalize phase (feature freeze)

| # | T+ | Prompt (summary) | AI output | Kept / Changed / Rejected | Why |
|---|---|---|---|---|---|
| 23 | 1:20 | Read-only check of the Railway project from #5 | 10 existing services unchanged (same deploy IDs). Ours: 1 service with **no deployments**, 1 empty volume, 3 variables | Corrected my proposed "caught before any changes" wording to the accurate version in #5 | The log must match reality, even when the truth is less flattering |
| 24 | 1:22 | Make the process log chronological and neutral; restructure SUBMISSION.md | Elapsed times checked against `git log`; 2 estimated times corrected; long rows trimmed, with the detail moved to ARCHITECTURE.md; SUBMISSION maps every requirement in the brief | Kept | A reviewer can check each requirement in one table |
| 25 | 1:25 | Fresh clone: follow the README exactly | **Found a bug:** `npm start` crashed on a clean clone because PGlite doesn't create `data/`. Fixed; the clean clone now passes install, build, 9/9 tests, typecheck and 18/18 E2E | Fixed | Only a clean environment catches "works on my machine" |
| 26 | 1:27 | Scan for secrets; add `.env.example` | All 13 commits: the real database password appears 0 times, no Postgres URLs with credentials, no env or db files tracked. Added `.env.example` and `--env-file-if-exists` | Kept | Public repo |
| 27 | 1:29 | Final production check | E2E against the live URL, then all test data deleted (3 seeded users only) | **18/18 checks passed on the live URL**; afterwards: 0 documents, shares and versions, only the 3 seeded users | Reviewers start with a clean, verified build |
