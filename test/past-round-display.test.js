const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('past rounds retain submissions and results without the activity log', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/pages.js'), 'utf8');
  const card = source.slice(source.indexOf('function PastRoundCard('), source.indexOf('function PollPage('));
  assert.ok(card.length > 500);
  assert.doesNotMatch(card, /Activity log|recorded events|events\.map|event\.created_at|View saved results before reset/);
  for (const label of ['Category:', 'Tie resolved randomly', 'Category submissions', 'Wheel results', 'Movie submissions', 'Bracket entries:', 'Archived', 'Completed']) {
    assert.ok(card.includes(label), label);
  }
});
