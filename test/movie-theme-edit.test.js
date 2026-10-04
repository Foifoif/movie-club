const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/components.js'), 'utf8');
const form = source.slice(source.indexOf('function EditHistoryMovieForm('), source.indexOf('// ─── WATCHLIST ADD FORM'));
// Exercise the actual form's save handler without a DOM or JSX dependency.
const handler = form.slice(0, form.indexOf('\n  return (')) + '\n return handleSave;\n}';

for (const theme of ['  Dolly Month: New theme  ', '']) {
  test(`theme edit saves existing row and updates card state (${theme ? 'changed' : 'cleared'})`, async () => {
    const movie = {id:1, title:'The Best Little Whorehouse in Texas', year:1982,
      poster:'poster.jpg', ratingScale:'Whorehomes', sessionTheme:'Dolly Month: Whorehomes'};
    let index = 0, saved, local;
    const context = vm.createContext({
      useState(initial) { return [index++ === 5 ? theme : initial, () => {}]; },
      async dbUpdateHistoryMovie(id, updates) { saved = {id, updates}; },
    });
    vm.runInContext(handler, context);
    await context.EditHistoryMovieForm({movie, onSave: updates => { local = updates; }})();
    assert.equal(saved.id, 1);
    assert.equal(saved.updates.session_theme, theme.trim() || null);
    assert.equal(local.sessionTheme, theme.trim());
    assert.equal(saved.updates.rating_scale, 'Whorehomes');
    assert.deepEqual(Object.keys(saved.updates).sort(), ['poster','rating_scale','session_theme','title','year']);
    assert.equal(movie.sessionTheme, 'Dolly Month: Whorehomes');
  });
}

test('movie edit exposes separate session theme and rating label controls', () => {
  assert.match(form, /Session theme \(shown on the movie card\)/);
  assert.match(form, /value=\{sessionTheme\}/);
  assert.match(form, /Rating label \(used when session theme is blank\)/);
});
