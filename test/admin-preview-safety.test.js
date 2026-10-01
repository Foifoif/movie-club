const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin test bracket does not call shared bracket persistence', () => {
  const source = fs.readFileSync(path.join(__dirname,'../js/pages.js'),'utf8');
  const admin = source.slice(source.indexOf('function AdminPanel('), source.indexOf('function AdminLogin'));
  assert.ok(admin.length > 1000);
  assert.match(admin,/const \[bracket, setBracket\] = useState\(null\)/);
  assert.doesNotMatch(admin,/dbSaveBracket(?:History)?\s*\(/);
  assert.doesNotMatch(admin,/onBracketHistoryAdd/);
});
