# Round admin production rollout

Status: preparation authorized; production execution still requires approval.

## Targets

- Repository/PR: Foifoif/movie-club, PR #37.
- Website: https://amovieclub.com/ (Cloudflare Pages).
- Worker: movie-club-round-worker; scheduled every five minutes.
- Supabase: schtizxdezxteulbvynp (shared production data).
- Consolidated SQL: supabase/migrations/20261001_round_admin_hardening.sql.

## Before approval

1. Push pending commits after GitHub workflow authorization. Confirm the Round
   regression check passes on the exact commit to release.
2. Inspect current production round/phase/matchup state read-only. Do not advance,
   reopen, archive or delete the club's real round for testing.
3. Capture existing function definitions and current Worker deployment identifier;
   confirm a database backup/recovery point exists before SQL replacement.
4. Review the migration against the functions actually installed in production.
   Local PGlite fixtures are not proof of production schema compatibility.
5. Agree on a maintenance window: the five-minute timer could process overdue
   phases as soon as the replacement functions are installed.

## Approved release order

1. Record and temporarily suspend the Worker timer during the database/Worker
   transition. Record its original schedule for restoration.
2. Apply the consolidated migration in a transaction. Validate function signatures
   and service-role-only admin grants. Notify PostgREST to reload its schema cache.
3. Deploy the Worker from the reviewed commit, preserving existing encrypted
   secrets and routing. Do not copy service-role credentials into frontend config.
4. Merge the reviewed PR and confirm Cloudflare Pages deploys the intended commit.
5. Check admin session status, round/history loading, and current phase display
   without changing existing club data. Exercise mutating paths only with an
   explicitly approved disposable test round; test rounds share production data
   and may appear to members, so they are not invisible staging.
6. Restore the five-minute timer and confirm a successful scheduled invocation.
   Monitor errors and phase timing; do not force a real phase forward merely to
   obtain a passing smoke test.

## Rollback

- Before transaction commit, roll back any failing migration transaction.
- After commit, restore captured function definitions only after checking whether
  new round transitions have occurred. A code rollback does not undo data changes.
- Restore the previous Worker deployment and Pages deployment if needed, keeping
  database/API compatibility in mind. Leave the timer suspended if processing is
  unsafe, and report this explicitly rather than silently stopping automation.
- Never delete submissions or rounds as a rollback shortcut.

## Completion evidence

Record the applied migration time, Worker deployment ID, Pages commit/deployment,
CI result, API checks, timer result and any approved disposable test-round IDs.
Do not call the rollout complete based solely on local tests or a preview build.
