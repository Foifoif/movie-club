const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/db.js'),'utf8');
function context(rows=[]) {
 const c=vm.createContext({sb:{from(table){
  let data=table==='rounds'?[...rows]:[];
  const q={select(){return q;},in(key,values){data=data.filter(row=>values.includes(row[key]));return q;},
   eq(key,value){data=data.filter(row=>row[key]===value);return q;},
   order(){return q;},limit(n){data=data.slice(0,n);return q;},then(resolve){return Promise.resolve({data}).then(resolve);}};
  return q;
 }}}); vm.runInContext(source,c); return c;
}
test('newest completed round remains current until close, then only appears in Past',async()=>{
 const rows=[{id:3,status:'COMPLETE',archived_at:null},{id:2,status:'COMPLETE',archived_at:null}];
 const c=context(rows);
 assert.equal((await c.dbLoadRoundWorkflow()).round.id,3);
 assert.deepEqual(Array.from(await c.dbLoadRoundHistory(),r=>r.id),[2]);
 rows[0].archived_at='2026-10-04';
 assert.equal(await c.dbLoadRoundWorkflow(),null,'older completed round must not resurface');
 assert.deepEqual(Array.from(await c.dbLoadRoundHistory(),r=>r.id),[3,2]);
 rows.unshift({id:4,status:'ACTIVE'});
 assert.equal((await c.dbLoadRoundWorkflow()).round.id,4);
 rows[0].status='CANCELLED';rows[0].archived_at='2026-10-05';
 assert.equal(await c.dbLoadRoundWorkflow(),null);
});
test('scrambled uses both recorded finalists; paired uses only winning team',()=>{
 const c=context();
 const entries=[{id:1,movie_a_title:'A'},{id:2,movie_a_title:'B'},{id:3,entry_type:'PAIR',movie_a_title:'C',movie_b_title:'D'}];
 const workflow={round:{status:'COMPLETE',mode:'scrambled'},entries,events:[
  {event_type:'ROUND_COMPLETED',payload:{final_entry_ids:[2,3]}},
  {event_type:'ROUND_COMPLETED',payload:{final_entry_ids:[1,2]}},
 ]};
 assert.deepEqual(Array.from(c.roundWinningEntries(workflow),e=>e.id),[1,2]);
 workflow.round.mode='paired';workflow.events.push({event_type:'ROUND_COMPLETED',payload:{winner_entry_id:3}});
 assert.deepEqual(Array.from(c.roundWinningEntries(workflow),e=>e.movie_b_title),['D']);
 workflow.round.status='ACTIVE';assert.equal(c.roundWinningEntries(workflow).length,0,'reopened round must not show stale winners');
});
test('legacy fallback includes bye winner, ignores cancelled rounds, and never invents missing winners',()=>{
 const c=context();
 const w={round:{status:'COMPLETE',mode:'scrambled'},entries:[{id:1},{id:2}],events:[],matchups:[
  {status:'CLOSED',bracket_round_number:2,winner_entry_id:1,result_entry_ids:[1]},
  {status:'CLOSED',bracket_round_number:2,winner_entry_id:2,entry_a_id:2,entry_b_id:null},
  {status:'CANCELLED',bracket_round_number:3,winner_entry_id:99},
 ]};
 assert.deepEqual(Array.from(c.roundWinningEntries(w),e=>e.id),[1,2]);
 w.matchups=[{status:'CLOSED',bracket_round_number:2,entry_a_id:1,entry_b_id:2,winner_entry_id:1}];
 assert.equal(c.roundWinningEntries(w).length,2,'legacy final vote cannot eliminate the second scrambled winner');
 w.entries.pop();assert.equal(c.roundWinningEntries(w).length,0);
});
