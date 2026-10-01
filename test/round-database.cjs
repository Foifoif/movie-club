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
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261001_round_admin_hardening.sql'), 'utf8'));
    const { rows: permissions } = await db.query(`select p.oid::regprocedure::text as function,
      has_function_privilege('anon',p.oid,'EXECUTE') as anonymous,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as member,
      has_function_privilege('service_role',p.oid,'EXECUTE') as admin
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('mc_create_round','mc_delete_round','mc_process_due_rounds','mc_build_bracket_immediate','mc_reopen_phase')`);
    assert.ok(permissions.length >= 5);
    for(const permission of permissions) {
      assert.equal(permission.anonymous,false,permission.function);
      assert.equal(permission.member,false,permission.function);
      assert.equal(permission.admin,true,permission.function);
    }
    console.log('PASS: migration reruns and admin functions reject browser roles');
    const { rows: [round] } = await db.query("select * from mc_create_round('Test',null,1,now(),48)");
    const { rows: [legacy] } = await db.query("select * from mc_create_round('Legacy call',null,1,now())");
    assert.equal(legacy.mode,null);
    assert.equal(legacy.default_duration_hours,24);
    const { rows: [deadline] } = await db.query("select mc_round_deadline($1,'2026-10-01T22:00:00Z') as closes",[legacy.id]);
    assert.equal(new Date(deadline.closes).toISOString(),'2026-10-02T16:00:00.000Z');
    const { rows: [dstDeadline] } = await db.query("select mc_round_deadline($1,'2026-10-31T22:00:00Z') as closes",[legacy.id]);
    assert.equal(new Date(dstDeadline.closes).toISOString(),'2026-11-01T17:00:00.000Z');
    await db.query('select mc_archive_round($1,1)',[legacy.id]);
    assert.equal(round.default_duration_hours, 48);
    const { rows: [phase] } = await db.query('select * from round_phases where round_id=$1 and phase_type=$2', [round.id, 'CATEGORY_SUBMISSIONS']);
    await db.query("select mc_submit_category($1,1,'Comedy')", [phase.id]);
    const { rows: [spin] } = await db.query("select * from mc_advance_phase($1,1,'admin')", [phase.id]);
    await db.query('select mc_spin_category($1,1)', [spin.id]);
    await db.query("select mc_open_movie_stage($1,'scrambled',1)", [round.id]);
    const { rows: events } = await db.query("select payload from round_events where event_type='CATEGORY_WINNER_SELECTED'");
    assert.equal(events[0].payload.category, 'comedy');
    await assert.rejects(db.query("select mc_open_movie_stage($1,'paired',1)", [round.id]), /already opened/);
    const { rows: [sameMode] } = await db.query('select mode from rounds where id=$1', [round.id]);
    assert.equal(sameMode.mode, 'scrambled', 'retry cannot change mode or reroll category');
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
      await assert.rejects(db.query("select mc_advance_phase($1,1,'admin')", [moviePhase.id]), /Phase cannot be advanced/);
      const { rows: [bracketPhase] } = await db.query("select id from round_phases where round_id=$1 and phase_type='BRACKET'", [fixture.id]);
      await assert.rejects(db.query("select mc_advance_phase($1,1,'admin')", [bracketPhase.id]), /Advance bracket matchups/);
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
      await db.query('select mc_reopen_phase($1,1)', [moviePhase.id]);
      const { rows: retained } = await db.query('select id from movie_submissions where phase_id=$1', [moviePhase.id]);
      assert.equal(retained.length, 8);
      const { rows: [snapshot] } = await db.query("select payload from round_events where round_id=$1 and event_type='BRACKET_RESET_FOR_SUBMISSIONS'", [fixture.id]);
      assert.ok(snapshot.payload.matchups.length > 0);
      await db.query("select mc_advance_phase($1,1,'admin')", [moviePhase.id]);
      const { rows: rebuilt } = await db.query('select id from bracket_matchups where round_id=$1', [fixture.id]);
      assert.ok(rebuilt.length > 0, 'bracket rebuilt from retained submissions');
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
    await db.query('select mc_reopen_phase($1,1)', [phase.id]);
    const { rows: resetPhases } = await db.query('select phase_type,status from round_phases where round_id=$1', [round.id]);
    assert.equal(resetPhases.filter(p=>p.status==='OPEN').length, 1);
    assert.equal(resetPhases.find(p=>p.status==='OPEN').phase_type, 'CATEGORY_SUBMISSIONS');
    const { rows: clearedSpins } = await db.query('select id from category_spins where phase_id=$1', [spin.id]);
    assert.equal(clearedSpins.length, 0);
    await db.query('select mc_archive_round($1,1)', [round.id]);
    await assert.rejects(db.query('select mc_reopen_phase($1,1)', [phase.id]), /Archived rounds/);
    await assert.rejects(db.query("select mc_advance_phase($1,1,'admin')", [phase.id]), /Phase cannot be advanced/);
    console.log('PASS: category reopening resets downstream work; archived round stays closed');
    const { rows: [odd] } = await db.query("select * from mc_create_round_at_movie_stage('Three unique movies','scrambled','Drama',1,24)");
    const { rows: [oddPhase] } = await db.query("select id from round_phases where round_id=$1 and phase_type='MOVIE_SUBMISSIONS'", [odd.id]);
    for (let member=1; member<=2; member++) for (let slot=1; slot<=2; slot++) {
      const movieId=member+slot;
      await db.query('select mc_submit_movie($1,$2,$3::smallint,$4,$5,2020,null)', [oddPhase.id,member,slot,movieId,`Movie ${movieId}`]);
    }
    await db.query("select mc_advance_phase($1,1,'admin')", [oddPhase.id]);
    const { rows: oddMatches } = await db.query('select * from bracket_matchups where round_id=$1', [odd.id]);
    const bye=oddMatches.find(m=>!m.entry_b_id);
    const contest=oddMatches.find(m=>m.status==='OPEN');
    assert.ok(bye && contest);
    await db.query('select mc_resolve_matchup_immediate($1,1)', [contest.id]);
    const { rows: [oddResult] } = await db.query("select payload from round_events where round_id=$1 and event_type='ROUND_COMPLETED'", [odd.id]);
    assert.equal(oddResult.payload.final_entry_ids.length,2);
    assert.ok(oddResult.payload.final_entry_ids.includes(Number(bye.winner_entry_id)));
    console.log('PASS: three unique scrambled movies retain the bye winner and matchup winner');
    const { rows: [pairedBye] } = await db.query("select * from mc_create_round_at_movie_stage('Weighted bye','paired','Drama',1,24)");
    const { rows: [pairedPhase] } = await db.query("select id from round_phases where round_id=$1 and phase_type='MOVIE_SUBMISSIONS'", [pairedBye.id]);
    // Ali: Heat/Odyssey; Evan: Odyssey/Shrek; Wendi: Alien/Shrek.
    // Jess repeats Ali's pair in reverse order, which must merge.
    const pairs = [[101,102],[102,103],[104,103],[102,101]];
    for (let member=1; member<=pairs.length; member++) for (let slot=1; slot<=2; slot++) {
      const movieId=pairs[member-1][slot-1];
      await db.query('select mc_submit_movie($1,$2,$3::smallint,$4,$5,2020,null)', [pairedPhase.id,member,slot,movieId,`Movie ${movieId}`]);
    }
    await db.query("select mc_advance_phase($1,1,'admin')", [pairedPhase.id]);
    const { rows: pairEntries } = await db.query('select * from bracket_entries where round_id=$1', [pairedBye.id]);
    assert.equal(pairEntries.length,3,'identical unordered pairs merge');
    assert.equal(Number(pairEntries.find(entry=>entry.bye_awarded).source_member_id),2,'Evan receives the weighted bye');
    console.log('PASS: identical pairs merge and both-duplicate pair receives bye');
    const { rows: [tieRound] } = await db.query("select * from mc_create_round('Category tie',null,1,now(),24)");
    const { rows: [tieSubmission] } = await db.query("select id from round_phases where round_id=$1 and phase_type='CATEGORY_SUBMISSIONS'", [tieRound.id]);
    await db.query("select mc_submit_category($1,1,'Comedy')", [tieSubmission.id]);
    await db.query("select mc_submit_category($1,2,'Horror')", [tieSubmission.id]);
    const { rows: [tieSpin] } = await db.query("select * from mc_advance_phase($1,1,'admin')", [tieSubmission.id]);
    // Fixture outcomes isolate tie resolution from the randomness of each spin.
    await db.query("insert into category_spins(phase_id,member_id,result_category,result_weight,random_receipt) values ($1,1,'comedy',1,'fixture-a'),($1,2,'horror',1,'fixture-b')", [tieSpin.id]);
    await db.query("select mc_open_movie_stage($1,'paired',1)", [tieRound.id]);
    const { rows: [tieEvent] } = await db.query("select payload from round_events where round_id=$1 and event_type='CATEGORY_WINNER_SELECTED'", [tieRound.id]);
    assert.equal(tieEvent.payload.tie,true);
    assert.deepEqual(tieEvent.payload.tied_categories,['comedy','horror']);
    assert.ok(tieEvent.payload.tied_categories.includes(tieEvent.payload.category));
    await assert.rejects(db.query("select mc_open_movie_stage($1,'paired',1)", [tieRound.id]), /already opened/);
    const { rows: savedWinners } = await db.query("select payload from round_events where round_id=$1 and event_type='CATEGORY_WINNER_SELECTED'", [tieRound.id]);
    assert.equal(savedWinners.length,1);
    assert.equal(savedWinners[0].payload.category,tieEvent.payload.category);
    console.log('PASS: category tie selects a tied leader once and records the tie');
    await db.query('select mc_reopen_phase($1,1)', [tieSpin.id]);
    const { rows: wheelPhases } = await db.query("select phase_type from round_phases where round_id=$1 and status='OPEN'", [tieRound.id]);
    assert.deepEqual(wheelPhases.map(p=>p.phase_type), ['CATEGORY_SPIN']);
    const { rows: [wheelRound] } = await db.query('select mode from rounds where id=$1', [tieRound.id]);
    assert.equal(wheelRound.mode,null);
    await db.query('select mc_spin_category($1,1)', [tieSpin.id]);
    await db.query("select mc_open_movie_stage($1,'scrambled',1)", [tieRound.id]);
    console.log('PASS: reopening wheel resets downstream stages and allows a fresh movie stage');
    // Expire only this fixture's deadlines; no wall-clock sleeps or live data.
    for (const mode of ['paired','scrambled']) {
      const { rows: [auto] } = await db.query("select * from mc_create_round_at_movie_stage($1,$2,'Drama',1,24)", [`Automatic ${mode}`,mode]);
      const { rows: [autoPhase] } = await db.query("select id from round_phases where round_id=$1 and phase_type='MOVIE_SUBMISSIONS'", [auto.id]);
      for (let member=1; member<=4; member++) for (let slot=1; slot<=2; slot++) {
        await db.query('select mc_submit_movie($1,$2,$3::smallint,$4,$5,2020,null)', [autoPhase.id,member,slot,member*10+slot,`Auto ${member}-${slot}`]);
      }
      await db.query('select mc_process_due_rounds()');
      for (let iteration=0; iteration<5; iteration++) {
        const { rows: open } = await db.query("select * from bracket_matchups where round_id=$1 and status='OPEN'", [auto.id]);
        if (!open.length) break;
        await db.query("update bracket_matchups set opens_at=now()-interval '1 hour',closes_at=now()+interval '1 hour' where round_id=$1 and status='OPEN'", [auto.id]);
        for (const matchup of open) for(let member=1;member<=4;member++) {
          await db.query('select mc_vote_matchup($1,$2,$3)', [matchup.id,member,matchup.entry_a_id]);
        }
        await db.query("update bracket_matchups set closes_at=now()-interval '1 minute' where round_id=$1 and status='OPEN'", [auto.id]);
        await db.query('select mc_process_due_rounds()');
      }
      const { rows: [autoStatus] } = await db.query('select status from rounds where id=$1',[auto.id]);
      assert.equal(autoStatus.status,'COMPLETE', `${mode} automatic completion`);
      const { rows: [autoResult] } = await db.query("select payload from round_events where round_id=$1 and event_type='ROUND_COMPLETED'",[auto.id]);
      if(mode==='scrambled') assert.equal(autoResult.payload.final_entry_ids.length,2);
      else assert.ok(autoResult.payload.winner_entry_id);
      console.log(`PASS: ${mode} automatic submission closure and bracket completion`);
    }
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
