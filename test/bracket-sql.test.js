'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('bracket resolver tie queries qualify entry_id', () => {
  const builder = read('supabase/migrations/20260824_round_bracket_builder.sql');
  const progression = read('supabase/migrations/20260824_round_scrambled_progression_fix.sql');
  assert.doesNotMatch(`${builder}\n${progression}`, /group\s+by\s+entry_id\b/i);
  assert.match(`${builder}\n${progression}`, /group\s+by\s+public\.bracket_votes\.entry_id\b/i);
});

test('scrambled final is finalized without a vote', () => {
  const migration = read('supabase/migrations/20260831_scrambled_final_no_vote.sql');
  const ui = read('js/pages.js');
  assert.match(migration, /result_entry_ids\s*=\s*array\[entry_a_id, entry_b_id\]/);
  assert.match(migration, /final_two_no_vote/);
  assert.match(ui, /Final two winners/);
  assert.match(ui, /disabled=\{saving \|\| !currentUser\?\.id \|\| scrambledFinal\}/);
});

test('round admin hardening uses the existing round model', () => {
  const migration = read('supabase/migrations/20261001_round_admin_hardening.sql');
  const ui = read('js/pages.js');
  const worker = read('cloudflare/round-worker/src/index.js');
  assert.match(migration, /p_default_duration_hours integer default 24/);
  assert.match(migration, /p_mode is not null and p_mode not in/);
  assert.match(migration, /mc_create_round_at_movie_stage/);
  assert.match(migration, /CATEGORY_WINNER_SELECTED/);
  assert.match(migration, /Choose a bracket mode and open the movie stage/);
  assert.match(migration, /mc_resolve_matchup_immediate/);
  assert.match(migration, /closes_at = now\(\) \+ public\.mc_round_duration\(result_matchup\.round_id\)/);
  assert.match(migration, /mc_round_duration/);
  assert.match(migration, /mc_build_bracket_immediate/);
  assert.match(migration, /desired_open := coalesce\(desired_open, now\(\)\)/);
  assert.match(migration, /Only an archived round can be permanently deleted/);
  assert.match(ui, /Start movie submission round/);
  assert.match(ui, /categorySpinReadyForMovieStage/);
  assert.match(ui, /const next = await dbLoadRoundWorkflow\(\);/);
  assert.match(ui, /p_default_duration_hours: Number\(roundDuration\)/);
  assert.match(ui, /mc_delete_round/);
  assert.match(worker, /'mc_delete_round'/);
  assert.match(worker, /'mc_create_round_at_movie_stage'/);
  assert.doesNotMatch(migration, /create table/i);
});
