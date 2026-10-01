// Run with NODE_PATH pointing to a directory containing @electric-sql/pglite.
// All fixtures live in an isolated in-memory PostgreSQL database.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.members (id bigint primary key, name text);
      insert into public.members values (1,'Ali'),(2,'Evan'),(3,'Wendi'),(4,'Jess');`);
    for (const file of [
      '20260824_round_workflow.sql',
      '20260824_round_workflow_functions.sql',
      '20260824_round_transitions.sql',
      '20260824_round_mode_after_spin.sql',
      '20260824_round_bracket_builder.sql',
      '20260824_round_archive.sql',
      '20260824_round_open_time_enforcement.sql',
      '20260828_bracket_posters.sql',
      '20261001_round_admin_hardening.sql',
    ]) {
      await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8'));
    }
    const { rows: [round] } = await db.query("select * from mc_create_round('Test',null,1,now(),48)");
    assert.equal(round.default_duration_hours, 48);
    const { rows: [phase] } = await db.query('select * from round_phases where round_id=$1 and phase_type=$2', [round.id, 'CATEGORY_SUBMISSIONS']);
    await db.query("select mc_submit_category($1,1,'Comedy')", [phase.id]);
    const { rows: [spin] } = await db.query("select * from mc_advance_phase($1,1,'admin')", [phase.id]);
    await db.query('select mc_spin_category($1,1)', [spin.id]);
    await db.query("select mc_open_movie_stage($1,'scrambled',1)", [round.id]);
    const { rows: events } = await db.query("select payload from round_events where event_type='CATEGORY_WINNER_SELECTED'");
    assert.equal(events[0].payload.category, 'comedy');
    console.log('PASS: create → category → spin → movie stage, custom duration and persisted winner');
    for (const mode of ['scrambled', 'paired']) {
      const { rows: [fixture] } = await db.query("select * from mc_create_round_at_movie_stage($1,$2,'Drama',1,48)", [mode, mode]);
      const { rows: [moviePhase] } = await db.query("select * from round_phases where round_id=$1 and phase_type='MOVIE_SUBMISSIONS'", [fixture.id]);
      for (let member = 1; member <= 4; member++) {
        for (let slot = 1; slot <= 2; slot++) {
          await db.query('select mc_submit_movie($1,$2,$3::smallint,$4,$5,2020,null)',
            [moviePhase.id, member, slot, member * 10 + slot, `Movie ${member}-${slot}`]);
        }
      }
      await db.query("select mc_advance_phase($1,1,'admin')", [moviePhase.id]);
      await db.query("update round_phases set closes_at=now()-interval '1 minute' where round_id=$1 and phase_type='BRACKET'", [fixture.id]);
      await db.query("update bracket_matchups set closes_at=now()-interval '1 minute' where round_id=$1 and status='OPEN'", [fixture.id]);
      await db.query('select mc_process_due_rounds()');
      const { rows: [stillActive] } = await db.query('select status from rounds where id=$1', [fixture.id]);
      assert.equal(stillActive.status, 'ACTIVE', 'bracket deadline cannot complete the entire round');
      const { rows: extended } = await db.query("select closes_at > now() as extended from bracket_matchups where round_id=$1 and status='OPEN'", [fixture.id]);
      assert.ok(extended.every(matchup => matchup.extended), 'insufficient bracket votes extend deadline');
      for (let iteration = 0; iteration < 6; iteration++) {
        const { rows: open } = await db.query("select * from bracket_matchups where round_id=$1 and status='OPEN' order by id", [fixture.id]);
        if (!open.length) break;
        for (const matchup of open) {
          await db.query('select mc_vote_matchup($1,1,$2)', [matchup.id, matchup.entry_a_id]);
          await db.query('select mc_resolve_matchup_immediate($1,1)', [matchup.id]);
        }
      }
      const { rows: [finished] } = await db.query('select status from rounds where id=$1', [fixture.id]);
      assert.equal(finished.status, 'COMPLETE', mode);
      const { rows: [completion] } = await db.query("select payload from round_events where round_id=$1 and event_type='ROUND_COMPLETED' order by id desc limit 1", [fixture.id]);
      if (mode === 'scrambled') assert.equal(completion.payload.final_entry_ids.length, 2);
      else assert.ok(completion.payload.winner_entry_id);
      console.log(`PASS: ${mode} submissions → bracket votes → correct winner count`);
      await db.query('select mc_reopen_bracket_round($1,1,1)', [fixture.id]);
      const { rows: reopened } = await db.query("select * from bracket_matchups where round_id=$1 and bracket_round_number=1 and status='OPEN' order by id", [fixture.id]);
      for (const matchup of reopened) await db.query('select mc_resolve_matchup_immediate($1,1)', [matchup.id]);
      const { rows: next } = await db.query("select opens_at <= now() as ready from bracket_matchups where round_id=$1 and status='OPEN'", [fixture.id]);
      assert.ok(next.length > 0);
      assert.ok(next.every(matchup => matchup.ready), 'reopened progression opens immediately');
      await db.query('select mc_archive_round($1,1)', [fixture.id]);
      await db.query('select mc_delete_round($1,1)', [fixture.id]);
      const { rows: remaining } = await db.query('select id from bracket_matchups where round_id=$1', [fixture.id]);
      assert.equal(remaining.length, 0);
      console.log(`PASS: ${mode} reopen → advance → archive → guarded delete`);
    }
    const { rows: [timed] } = await db.query("select * from mc_create_round('Timer test',null,1,now(),24)");
    const { rows: [timedPhase] } = await db.query("select * from round_phases where round_id=$1 and phase_type='CATEGORY_SUBMISSIONS'", [timed.id]);
    await db.query("update round_phases set closes_at=now()-interval '1 minute' where id=$1", [timedPhase.id]);
    await db.query('select mc_process_due_rounds()');
    const { rows: [extendedPhase] } = await db.query('select status, closes_at > now() as extended from round_phases where id=$1', [timedPhase.id]);
    assert.equal(extendedPhase.status, 'OPEN');
    assert.equal(extendedPhase.extended, true);
    for (let member=1; member<=4; member++) await db.query("select mc_submit_category($1,$2,'Comedy')", [timedPhase.id,member]);
    await db.query('select mc_process_due_rounds()');
    const { rows: [scheduledSpin] } = await db.query("select status, opens_at=mc_next_9am_pacific(now()) as scheduled from round_phases where round_id=$1 and phase_type='CATEGORY_SPIN'", [timed.id]);
    assert.equal(scheduledSpin.status, 'OPEN');
    assert.equal(scheduledSpin.scheduled, true);
    console.log('PASS: insufficient responses extend deadline; everyone complete schedules next phase at 9 AM Pacific');
    const { rows: [empty] } = await db.query("select * from mc_create_round_at_movie_stage('Empty bracket','paired','Drama',1,24)");
    const { rows: [emptyPhase] } = await db.query("select id from round_phases where round_id=$1 and phase_type='MOVIE_SUBMISSIONS'", [empty.id]);
    await assert.rejects(db.query("select mc_advance_phase($1,1,'admin')", [emptyPhase.id]), /At least two valid bracket entries/);
    const { rows: [unchanged] } = await db.query('select status from round_phases where id=$1', [emptyPhase.id]);
    assert.equal(unchanged.status, 'OPEN', 'failed bracket build rolls back phase closure');
    await assert.rejects(db.query('select mc_delete_round($1,1)', [empty.id]), /Only an archived round/);
    console.log('PASS: failed bracket build rolls back; active round deletion is rejected');
    const { rows: [two] } = await db.query("select * from mc_create_round_at_movie_stage('Two movies','scrambled','Drama',1,24)");
    const { rows: [twoPhase] } = await db.query("select id from round_phases where round_id=$1 and phase_type='MOVIE_SUBMISSIONS'", [two.id]);
    for (let slot=1; slot<=2; slot++) await db.query('select mc_submit_movie($1,1,$2::smallint,$2,$3,2020,null)', [twoPhase.id,slot,`Final ${slot}`]);
    await db.query("select mc_advance_phase($1,1,'admin')", [twoPhase.id]);
    const { rows: [twoDone] } = await db.query('select status from rounds where id=$1', [two.id]);
    assert.equal(twoDone.status, 'COMPLETE');
    const { rows: twoMatchups } = await db.query('select status,result_entry_ids from bracket_matchups where round_id=$1', [two.id]);
    assert.equal(twoMatchups[0].status, 'CLOSED');
    assert.equal(twoMatchups[0].result_entry_ids.length, 2);
    console.log('PASS: two scrambled entries complete immediately without voting');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
