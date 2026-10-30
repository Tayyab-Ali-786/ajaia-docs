# AI Workflow Note

## Tools

- **Claude Code** (CLI agent, Claude Opus) as a pair programmer working directly in the repo and terminal. It did planning, scaffolding, code, tests, deployment commands and the docs.
- **Headless Chrome via puppeteer-core**, driven by the AI, to check the real UI end to end.
- No other assistants. The timestamped prompt log is in [`PROCESS.md`](PROCESS.md).

## How I used it

1. **Plan before code.** I pasted the full brief and asked for a breakdown, the ambiguities and a timed plan before any code was written. The AI also checked my machine first (Node version, which deploy CLIs were installed and logged in), so the stack choice was based on what was actually there.
2. **Small, checkable slices:** backend + API tests → frontend → headless UI test → deploy → docs. Each slice was verified before the next started.
3. **I kept the decisions.** Stack, deploy target, repo visibility and scope cuts were my calls, made from options with tradeoffs that the AI presented (see [`DECISIONS.md`](DECISIONS.md)).

## Where AI materially sped things up

- **Boilerplate at full speed:**
  - the Express routes, validation and error middleware
  - the React screens
  - the TipTap toolbar wiring
  - the CSS

  This was about 1,000 lines in roughly 25 minutes. All 7 API tests passed on their first run.
- **Two mid-build infrastructure switches.** The Railway trial turned out to be expired, so persistence moved from `node:sqlite` to libSQL. When I chose Supabase instead, it moved again to Postgres. Each time the AI used a thin `DB` wrapper (`get/all/run`) plus a scripted, assertion-checked refactor of every call site. Tests stayed green after each switch (about 5–15 minutes each).
- **Setting up Supabase from the CLI.** I created a dedicated project with an explicit `--org-id` so the CLI couldn't fall back to a default. The AI noticed that the direct host is IPv6-only and fetched the IPv4 session-pooler URL. The database password stayed in a local file and never appeared in the chat or the repo.
- **Verification I wouldn't normally write for a take-home.** A two-user headless-Chrome run that checks formatting persistence, sharing and read-only mode, and produces the screenshots.

## What I changed or rejected

| AI output | What happened |
|---|---|
| Installed `@tiptap/extension-underline` | **Removed.** Checking the installed types showed TipTap v3's StarterKit already includes Underline. |
| Version check done in application code (read, compare, write) | **Changed** to `UPDATE … WHERE version = ?` and a check of `rowsAffected`, so the check and the write are one atomic step. |
| Postgres port: unquoted `AS updatedAt` aliases | **Fixed during the port.** Postgres lowercases unquoted identifiers, which would have broken the API's camelCase fields, so the aliases are now quoted. |
| E2E against Supabase: "Bob sees shared doc" failed | **Test timing, not an app bug.** The remote database is slower, and the test read the list while it still said "Loading…". The test now waits for the list to finish loading. |
| Returning 403 for documents you can't access | **Rejected** in favor of 404, so the API doesn't reveal which document ids exist. |
| Real-time collaboration as an optional extra | **Rejected** as a scope trap. Version-based conflict detection gives the "no silent data loss" guarantee at a fraction of the cost. |
| Railway deploy commands | **Caught a failure.** `railway init` errored, and the commands that followed silently used a different project linked from a parent directory. We stopped, reported it, and moved to Render plus a free managed database. Lesson: check `railway status` before running anything that changes state. |
| First E2E run reported a "rename not persisted" failure | **Diagnosed as a test bug, not an app bug.** A triple-click didn't select the input text, so the stored title was `Untitled documenQ4 Launch Plant`. I fixed the test rather than "fixing" working code. |

## How I verified correctness, UX and reliability

- **Correctness:**
  - 7 API tests on an in-memory database: auth, the formatting round-trip, the whole sharing path, 409 conflicts, XSS sanitization, validation, import.
  - `tsc --noEmit` with strict mode.
- **UX:** the headless-Chrome run drives the real UI as two users (toolbar, shortcuts, reload, share dialog, import, rejected upload, viewer read-only), and I reviewed every screenshot. That led to small fixes (link color, list spacing) and to adding a missing Delete button.
- **Reliability:**
  - I smoke-tested the production build locally (health check, SPA fallback, login, import → export) before deploying.
  - I re-ran the same checks against the live URL after deploying.
