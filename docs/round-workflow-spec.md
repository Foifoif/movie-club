# Movie Club Round Workflow

Status: product specification / implementation plan

This document defines the multi-round movie-selection workflow. External notifications are intentionally out of scope for the first implementation. Home is the initial notification channel.

## Operating rules

- Timezone: `America/Los_Angeles` (Pacific local time, including daylight-saving changes).
- New rounds open at 9:00 AM Pacific.
- Default duration for each phase is 24 hours.
- A phase advances when everyone eligible completes it, its timer expires, or an admin advances it manually.
- If the timer expires with fewer than 3 completed actions, the phase resets for another 24 hours.
- Users may edit their submission or vote until the phase closes.
- Admins may reopen a closed phase, advance a phase, undo a result, or cancel a round.
- Each user may submit, spin, or vote only once per phase. This must be enforced by database constraints, not only by the UI.

## Round state machine

```text
DRAFT
  -> CATEGORY_SUBMISSIONS_OPEN
  -> CATEGORY_SUBMISSIONS_CLOSED
  -> CATEGORY_SPIN_OPEN
  -> CATEGORY_SELECTED
  -> MOVIE_SUBMISSIONS_OPEN
  -> MOVIE_SUBMISSIONS_CLOSED
  -> BRACKET_ROUND_OPEN
  -> BRACKET_ROUND_CLOSED
  -> COMPLETE
```

Any active state can transition to `CANCELLED` by an admin. Closed states can transition back to their corresponding open state when an admin reopens them. A manual advance records the admin and reason.

When a phase completes early, the next phase is scheduled for the next day at 9:00 AM Pacific rather than starting immediately.

## Phase 1: category submissions

Each eligible member submits one short free-form genre or category. The member may edit it until the phase closes.

At close:

- Normalize whitespace and capitalization for matching.
- Exact duplicate categories merge.
- The number of submissions becomes the category weight.
- A category with four submissions occupies four weighted units in the spinner; a category with one submission occupies one.

## Phase 2: category spinner

The server creates one weighted random result for each member who spins. The browser only animates the wheel to display the already-recorded server result.

The category with the most recorded lands wins. If the tally is tied, the server randomly selects among the tied categories. The result is marked as a tie in history, including the tied categories and the selected winner.

If fewer than three members spin when the timer expires, the phase resets for another 24 hours. Otherwise, it closes with the recorded results.

## Phase 3: movie submissions

After a category is selected, every member submits exactly two movies using the existing movie-search experience.

- One movie is not valid; the form must show an error and prevent submission.
- Members may edit both movies until the phase closes.
- The canonical movie identity is the TMDB movie ID when available.
- The two movies submitted by a member form a permanent pair for paired mode.

## Bracket construction modes

### Scrambled mode

- Collect all submitted movies.
- Merge exact duplicate movie IDs before bracket construction.
- Every unique movie becomes an individual bracket entry.
- Randomize the entries and create matchups.
- Avoid byes where possible; if an odd count requires one, choose the bye randomly.
- Each bracket round gets its own 24-hour clock.
- The final two movies are the result of scrambled mode. There is no single final winner.

### Paired mode

- Each member's two submitted movies remain together as one permanent pair.
- Members vote for the pair as a bundle.
- Different pairs are not merged merely because they share one movie.
- If two pairs contain the exact same two canonical movies, merge those identical pairs into one pair.
- Randomize pair order and matchup order.
- If there is an odd number of pairs, assign one bye.

#### Duplicate-aware paired bye selection

When a bye is required, calculate each pair's duplicate score: the number of its movies that also appear in another non-identical pair.

Example:

```text
Ali:   Heat + The Odyssey       duplicate score 1
Evan:  The Odyssey + Shrek      duplicate score 2
Wendi: Alien + Shrek            duplicate score 1
```

Evan receives the bye because both of Evan's movies appear elsewhere. If two or more pairs tie for the highest duplicate score, randomly choose among those pairs. This weighting affects only bye selection; it does not give a pair extra votes or an advantage in later matchups.

If two pairs are identical, merge them first and do not use them as separate candidates for the bye.

## Bracket voting

- Each member casts one vote per matchup.
- A matchup closes when everyone eligible votes, the 24-hour timer expires with at least 3 votes, or an admin advances it.
- If fewer than 3 votes exist at expiry, reset the matchup round for another 24 hours.
- A tie is resolved by a server-side random choice and marked as a tie in history.
- The surviving entries advance to the next bracket round.
- Paired mode ends with one surviving pair.
- Scrambled mode ends with the final two surviving movies.
- Admins can reopen a matchup round, undo its result, or cancel the bracket.

## Scheduling and eligibility

- Store all timestamps in UTC.
- Convert the next opening time to `America/Los_Angeles` for the 9:00 AM Pacific schedule.
- Snapshot eligible members when a phase opens so people joining the club later do not change the completion threshold mid-phase.
- Record who was eligible, who completed, and who did not participate.

## Proposed database model

The existing single JSON bracket row is not sufficient for this workflow. Add normalized tables while preserving the existing poll and movie data during migration.

### `rounds`

- `id`
- `month_key`
- `status`
- `mode` (`scrambled` or `paired`)
- `default_duration_hours`
- `timezone`
- `next_open_at`
- `created_by`
- `created_at`
- `completed_at`
- `cancelled_at`
- `version`

### `round_phases`

- `id`
- `round_id`
- `phase_type`
- `status`
- `opens_at`
- `closes_at`
- `closed_reason` (`everyone_complete`, `timer`, `admin`, `minimum_not_met`)
- `reopened_at`
- `reopened_by`
- `advanced_by`
- `advance_reason`

### `category_submissions`

- `id`
- `phase_id`
- `member_id`
- `raw_text`
- `normalized_text`
- `created_at`
- `updated_at`
- Unique constraint on `(phase_id, member_id)`.

### `category_spins`

- `id`
- `phase_id`
- `member_id`
- `result_category_id`
- `random_seed_or_receipt`
- `created_at`
- Unique constraint on `(phase_id, member_id)`.

### `movie_submissions`

- `id`
- `phase_id`
- `member_id`
- `slot` (`1` or `2`)
- `tmdb_id`
- `title`
- `year`
- `poster`
- `created_at`
- `updated_at`
- Unique constraint on `(phase_id, member_id, slot)`.

### `bracket_entries`

- `id`
- `round_id`
- `entry_type` (`movie` or `pair`)
- `source_member_id`
- `movie_a_id`
- `movie_b_id`
- `duplicate_score`
- `bye_awarded`
- `seed`

### `bracket_matchups`

- `id`
- `round_id`
- `bracket_round_number`
- `entry_a_id`
- `entry_b_id`
- `status`
- `opens_at`
- `closes_at`
- `winner_entry_id`
- `tie_resolved`
- `tie_resolution_note`

### `bracket_votes`

- `id`
- `matchup_id`
- `member_id`
- `entry_id`
- `created_at`
- Unique constraint on `(matchup_id, member_id)`.

### `round_events`

Append-only audit history for submissions, edits, phase transitions, random results, ties, byes, admin actions, and errors.

- `id`
- `round_id`
- `phase_id`
- `event_type`
- `actor_member_id`
- `payload`
- `created_at`

### `home_notifications`

- `id`
- `round_id`
- `phase_id`
- `title`
- `body`
- `action_path`
- `created_at`
- `expires_at`

This is the initial notification channel. External delivery records can be added later without changing the round model.

## Security requirement

The current site uses an anonymous Supabase client and a name picker. That is acceptable for the existing lightweight club tools, but the new workflow needs server-side functions for:

- weighted spinner results;
- tie resolution;
- completion and timer transitions;
- duplicate-aware bye selection;
- enforcing one action per member;
- admin-only reopen, undo, and advance actions.

The client may request an action and display the result, but it must not be trusted to calculate or persist authoritative outcomes.

## Implementation order

1. Add the schema and server-side round transition functions.
2. Build admin round creation and phase controls.
3. Build category submission and spinner phases.
4. Build movie-pair submission and bracket construction.
5. Build matchup voting, timers, undo/reopen, and audit history.
6. Add Home notifications.
7. Migrate or retire the existing single-record bracket flow after the new flow is verified in staging.
