const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('published current films survive reload without moving the lineup or shifting legacy months',async()=>{
 const rows=[
  {id:1,title:'The Best Little Whorehouse in Texas',archived:false,shown_month:'October 2026',tmdb_id:16363},
  {id:2,title:'Steel Magnolias',archived:false,shown_month:'October 2026',tmdb_id:10860},
  {id:3,title:'The French Connection',archived:true},
  {id:42,title:'Exorcist III',archived:true},
 ];
 const ratings=[{movie_id:1,member_name:'Ali',score:4.5},{movie_id:2,member_name:'Ali',score:4}];
 const context=vm.createContext({ACCENT_COLORS:['blue'],HISTORY_META:Array.from({length:40},(_,i)=>({month:'Legacy '+i,theme:'Theme '+i})),
 sb:{from(table){const result={data:table==='movies'?rows:table==='ratings'?ratings:[]};const chain={then:resolve=>Promise.resolve(result).then(resolve)};for(const k of ['select','order','eq','maybeSingle'])chain[k]=()=>chain;return chain;}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/db.js'),'utf8'),context);
 for(const name of ['dbLoadPolls','dbLoadBracketHistory','dbLoadRoundHistory'])context[name]=async()=>[];
 context.dbLoadMonthlyEvents=async()=>({movie_id_1:1,movie_id_2:2});
 context.dbLoadRoundWorkflow=async()=>null;
 let result=await context.loadAll();
 assert.deepEqual(Array.from(result.currentMovies,m=>m.id),[1,2]);
 assert.deepEqual(Array.from(result.alltimeMovies,m=>m.id),[1,2,3,42]);
 assert.equal(result.alltimeMovies[0].month,'October 2026');
 assert.equal(result.alltimeMovies[2].month,'Legacy 0');
 assert.equal(result.alltimeMovies[3].month,'Legacy 39');
 assert.equal(result.ratingsData[1].Ali,4.5);assert.equal(result.ratingsData[2].Ali,4);
 rows[0].archived=true;result=await context.loadAll();
 assert.equal(result.alltimeMovies.find(m=>m.id===3).month,'Legacy 0');
 assert.equal(result.alltimeMovies.find(m=>m.id===1).month,'October 2026');
 // Edits must survive reload, including movies with imported metadata.
 rows[0].session_theme='Dolly Month: New theme';
 rows[2].session_theme='Edited session';
 rows[2].rating_scale='Edited rating label';
 result=await context.loadAll();
 assert.equal(result.alltimeMovies.find(m=>m.id===1).sessionTheme,'Dolly Month: New theme');
 assert.equal(result.alltimeMovies.find(m=>m.id===3).sessionTheme,'Edited session');
 assert.equal(result.alltimeMovies.find(m=>m.id===3).theme,'Edited rating label');
 rows[2].rating_scale=''; rows[2].session_theme=null;
 result=await context.loadAll();
 assert.equal(result.alltimeMovies.find(m=>m.id===3).theme,'');
 assert.equal(result.alltimeMovies.find(m=>m.id===3).sessionTheme,'');
});
