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
