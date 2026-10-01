const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('failed matchup query does not silently produce an empty bracket', async () => {
  const context = vm.createContext({
    sb: { from(table) {
      const result = table === 'rounds' ? { data: [{ id: 1 }] }
        : table === 'bracket_matchups' ? { data: null, error: { message: 'connection lost' } }
          : { data: [{ id: 1 }] };
      const chain = { then(resolve) { return Promise.resolve(result).then(resolve); } };
      for (const method of ['select', 'in', 'eq', 'order', 'limit']) chain[method] = () => chain;
      return chain;
    } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/db.js'), 'utf8'), context);
  await assert.rejects(context.dbLoadRoundWorkflow(), /Could not load complete round data: connection lost/);
  await assert.rejects(context.dbLoadRoundHistory(), /Could not load complete round history: connection lost/);
});
