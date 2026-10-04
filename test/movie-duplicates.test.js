const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../js/db.js'),'utf8');

function fixture({rows=[],readError=null,writeError=null}={}) {
  let inserts=0, updates=[];
  const context=vm.createContext({sb:{from(table){
    assert.equal(table,'movies');
    return {
      select(){return {order(){return {range:async(start,end)=>({data:rows.slice(start,end+1),error:readError})};}};},
      insert(row){inserts++;return {select(){return {single:async()=>({data:{id:99,...row},error:writeError})};}};},
      update(values){
        const filters=[];
        const chain={eq(k,v){filters.push([k,v]);return chain;},is(k,v){filters.push([k,v]);return chain;},select(){return chain;},async maybeSingle(){
          if(writeError)return {data:null,error:writeError};
          const row=rows.find(r=>filters.every(([k,v])=>r[k]===v));
          if(!row)return {data:null,error:null};
          updates.push({...values});Object.assign(row,values);return {data:{...row},error:null};
        }};return chain;
      },
    };
  }}});
  vm.runInContext(source,context);
  return {context,inserts:()=>inserts,updates};
}
test('movie identity uses TMDB, with normalized title/year for legacy data',()=>{
 const {context:c}=fixture();
 assert.equal(c.sameMovieIdentity({title:'Alien',tmdbId:1},{title:'Localized title',tmdb_id:'1'}),true);
 assert.equal(c.sameMovieIdentity({title:'The Thing',year:1982,tmdbId:1},{title:'The Thing',year:2011,tmdb_id:2}),false);
 assert.equal(c.sameMovieIdentity({title:'Same title',year:2020,tmdbId:1},{title:'Same title',year:2020,tmdb_id:2}),false);
 assert.equal(c.sameMovieIdentity({title:'  THE   THING ',year:'1982'},{title:'The Thing',year:1982,tmdbId:1}),true);
 assert.equal(c.sameMovieIdentity({title:'The Thing',year:1982},{title:'The Thing',year:2011}),false);
});
test('official Movie Night selection is published in-place and a repeat is rejected',async()=>{
 for(const movie of [{id:1,title:'The Best Little Whorehouse in Texas',tmdb_id:16363,year:1982},{id:2,title:'Steel Magnolias',tmdb_id:10860,year:1989}]){
  const row={...movie,archived:false,shown_month:null,avg_score:4.25,poster:'poster.jpg',session_theme:'Dolly',rating_scale:'stars'};
  const f=fixture({rows:[row]});
  const result=await f.context.dbAddHistoryMovie({title:row.title,year:row.year,tmdbId:row.tmdb_id,movieType:'official',sessionTheme:''});
  assert.equal(result.id,row.id);assert.equal(result.archived,false);assert.equal(result.avg_score,4.25);
  assert.equal(result.session_theme,'Dolly');assert.equal(result.poster,'poster.jpg');assert.ok(result.shown_month);
  assert.equal(f.inserts(),0);assert.deepEqual(Object.keys(f.updates[0]),['shown_month']);
  await assert.rejects(f.context.dbAddHistoryMovie({title:row.title,tmdbId:row.tmdb_id,movieType:'official'}),{code:'DUPLICATE_MOVIE'});
 }
});
test('official does not bypass history duplicates; impromptu cannot republish current picks',async()=>{
 const f=fixture({rows:[{id:1,title:'Steel Magnolias',tmdb_id:10860,archived:true,shown_month:'September 2026'}]});
 await assert.rejects(f.context.dbAddHistoryMovie({title:'Steel Magnolias',tmdbId:10860,movieType:'official'}),{code:'DUPLICATE_MOVIE'});
 const current=fixture({rows:[{id:1,title:'Steel Magnolias',tmdb_id:10860,archived:false,shown_month:null}]});
 await assert.rejects(current.context.dbAddHistoryMovie({title:'Steel Magnolias',tmdbId:10860,movieType:'impromptu'}),/Choose Official/);
 assert.equal(current.updates.length,0);assert.equal(f.inserts(),0);
});
test('shared duplicate is rejected without inserting or changing ratings',async()=>{
 const f=fixture({rows:[{id:3,title:'Alien',year:1979,tmdb_id:348}]});
 await assert.rejects(f.context.dbAddHistoryMovie({title:'Alien',year:1979,tmdbId:348}),{code:'DUPLICATE_MOVIE'});
 assert.equal(f.inserts(),0);
});
test('duplicate check includes rows beyond the first API page',async()=>{
 const rows=Array.from({length:1000},(_,i)=>({id:i,title:'Movie '+i,tmdb_id:i+1}));
 rows.push({id:1001,title:'Alien',tmdb_id:2000});
 const f=fixture({rows});
 await assert.rejects(f.context.dbAddHistoryMovie({title:'Alien',tmdbId:2000}),{code:'DUPLICATE_MOVIE'});
 assert.equal(f.inserts(),0);
});
test('database race conflict gives the same clear duplicate message',async()=>{
 const f=fixture({writeError:{code:'23505',message:'unique constraint violation'}});
 await assert.rejects(f.context.dbAddHistoryMovie({title:'Alien',tmdbId:348}),{code:'DUPLICATE_MOVIE'});
 assert.equal(f.inserts(),1);
});
test('failed duplicate lookup fails closed; a distinct film can be saved',async()=>{
 const failed=fixture({readError:new Error('offline')});
 await assert.rejects(failed.context.dbAddHistoryMovie({title:'Alien',tmdbId:348}),/offline/);
 assert.equal(failed.inserts(),0);
 const f=fixture();
 assert.equal((await f.context.dbAddHistoryMovie({title:'Alien',tmdbId:348})).title,'Alien');
 assert.equal(f.inserts(),1);
});
