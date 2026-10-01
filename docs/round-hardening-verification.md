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

Run database scenarios with `NODE_PATH` pointing at an installation of
`@electric-sql/pglite`: `node test/round-database.cjs`.
Run JavaScript tests with `node --test test/*.test.js`.

## Remaining verification and implementation

- Admin browser verification past login, including mobile layout and all controls.
- Audit category-spin reopening after movie submissions and completed-round selection.
- Verify user-visible history renders saved reset snapshots, not just event names.
- Test duplicate-pair bye weighting, tied category results, and automatic bracket completion.
- Verify timer and manual deadline policy against the agreed Pacific schedule.
- Review migration function overload compatibility and service-role permissions.
- Apply migration, deploy Worker and frontend in compatible order, then smoke-test deployed behavior.

The goal is not complete while these items remain.
