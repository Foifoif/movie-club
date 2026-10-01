# Round hardening verification

The October hardening migration replaces existing functions and uses existing tables.
It has not been applied to production. Local SQL execution uses an isolated PGlite
PostgreSQL instance; it does not connect to Supabase.

## Verified locally

- Creation with label, deferred mode choice, and stored default duration.
- Category submission, server-generated spin, and persisted category winner.
- Direct movie-submission start with a supplied category and mode.
- Movie submission to bracket creation in one transaction; failed builds roll back.
- Paired completion with one winning pair; scrambled completion with two winners.
- Two-entry scrambled completion without voting; three-entry completion retaining a bye.
- Manual progression, bracket reopening, and rebuilding after reopening movie submissions.
- Category reopening resets downstream data, preserving snapshots in existing events.
- Insufficient responses extend deadlines; everyone complete schedules 9 AM Pacific.
- Bracket deadlines do not prematurely complete the whole club round.
- Archive and archive-only deletion; archived phases cannot reopen or advance.
- Duplicate phase advancement and generic bracket-phase advancement are rejected.
- Failed matchup reads reject the workflow load instead of returning an empty bracket.
- Identical paired entries merge regardless of order; the supplied duplicate-weight bye example passes.
- Category ties choose and persist a tied leader once; reopening the wheel resets downstream phases.
- Automatic bracket progression completes in both modes.
- Old/new creation signatures work; migration can rerun; checked admin functions deny browser roles.
- Worker scheduled handler invokes the processor and surfaces database errors (mocked network).
- Worker admin authentication, secure session reuse, invalid requests, preflight,
  database errors, and uncertain network failures are covered by automated tests.
- The actual Worker is connected to isolated PostgreSQL through a named-argument
  RPC adapter: movie-stage creation, failed advancement rollback, archive, and
  deletion pass. This adapter is not a real PostgREST server, so deployed schema
  cache/signature validation still remains necessary.
- Default next-day 9 AM Pacific deadlines are checked across the daylight-saving
  boundary; explicit 48-hour configuration is checked independently.
- Isolated admin fixture renders in Chrome; setup/recovery sections expand. At 390×844,
  the modal scrolls vertically and document width equals viewport width (390 pixels).
- Completed-round fixture verified in Chrome: selecting a completed round exposes
  its submission/spin phases and non-cancelled bracket voting rounds; selecting
  a bracket round enables recovery. Cancelled rounds are omitted. No live writes.
- History child-query failures are surfaced instead of silently hiding matchups.
- Admin test-bracket state is local to the panel, with shared save/history calls
  removed. A source-boundary regression check guards against their return.

Run database scenarios with `NODE_PATH` pointing at an installation of
`@electric-sql/pglite`: `node test/round-database.cjs`.
Run JavaScript tests with `node --test test/*.test.js`.
The local `Round regression` GitHub workflow is configured to run both suites on
pull requests and main pushes without credentials or live database access. Its
push was rejected because the current GitHub authorization lacks `workflow`
scope; it is not installed remotely yet.

## Release gates

- Confirm a separate staging Supabase destination, or explicitly approve a
  production rollout. A Cloudflare/Netlify preview is not database isolation.
- Install the workflow with appropriately authorized GitHub access, then confirm
  its checks actually pass. Local test results do not prove CI execution.
- Apply the consolidated migration to the chosen database, deploy the Worker
  with matching database configuration, then deploy the frontend.
- Exercise authenticated named-argument RPCs through the deployed API. Verify
  creation, phase advancement, bracket completion/reopening, archive and delete
  with disposable test data in the approved environment, not a real club round.
- Verify timer execution and the final visible winner count in both modes.

## Remaining verification and implementation

- Real PostgREST/deployed admin action verification (local Worker-to-SQL adapter passes).
- Reset-history visual verification.
- Apply migration, deploy Worker and frontend in compatible order, then smoke-test deployed behavior.

The goal is not complete while these items remain.
