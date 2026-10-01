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
- Isolated admin fixture renders in Chrome; setup/recovery sections expand. At 390×844,
  the modal scrolls vertically and document width equals viewport width (390 pixels).

Run database scenarios with `NODE_PATH` pointing at an installation of
`@electric-sql/pglite`: `node test/round-database.cjs`.
Run JavaScript tests with `node --test test/*.test.js`.

## Remaining verification and implementation

- Integrated admin action verification against a disposable backend, beyond the read-only fixture.
- Completed-round selection and reset-history visual verification.
- Verify timer and manual deadline policy against the agreed Pacific schedule.
- Apply migration, deploy Worker and frontend in compatible order, then smoke-test deployed behavior.

The goal is not complete while these items remain.
