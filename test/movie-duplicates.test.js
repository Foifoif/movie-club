const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../js/db.js'),'utf8');

function fixture({rows=[],readError=null,writeError=null}={}) {
  let inserts=0;
  const context=vm.createContext({sb:{from(table){
    assert.equal(table,'movies');
    return {
      select(){return {order(){return {range:async(start,end)=>({data:rows.slice(start,end+1),error:readError})};}};},
      insert(row){inserts++;return {select(){return {single:async()=>({data:{id:99,...row},error:writeError})};}};},
    };
  }}});
  vm.runInContext(source,context);
  return {context,inserts:()=>inserts};
}
test('movie identity uses TMDB, with normalized title/year for legacy data',()=>{
 const {context:c}=fixture();
 assert.equal(c.sameMovieIdentity({title:'Alien',tmdbId:1},{title:'Localized title',tmdb_id:'1'}),true);
 assert.equal(c.sameMovieIdentity({title:'The Thing',year:1982,tmdbId:1},{title:'The Thing',year:2011,tmdb_id:2}),false);
 assert.equal(c.sameMovieIdentity({title:'Same title',year:2020,tmdbId:1},{title:'Same title',year:2020,tmdb_id:2}),false);
 assert.equal(c.sameMovieIdentity({title:'  THE   THING ',year:'1982'},{title:'The Thing',year:1982,tmdbId:1}),true);
 assert.equal(c.sameMovieIdentity({title:'The Thing',year:1982},{title:'The Thing',year:2011}),false);
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
