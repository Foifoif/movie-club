const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function worker(fetch) {
  const source = fs.readFileSync(path.join(__dirname,'../cloudflare/round-worker/src/index.js'),'utf8');
  const context = vm.createContext({fetch,Response,Request,URL});
  vm.runInContext(source.replace('export default {','globalThis.worker = {'),context);
  return context.worker;
}

test('scheduled Worker calls round timer processor', async () => {
  let called;
  const instance=worker(async (url,options)=>{
    called={url,options};
    return new Response('2',{status:200});
  });
  let pending;
  await instance.scheduled({}, {SUPABASE_SERVICE_ROLE_KEY:'test-only'}, {waitUntil(p){pending=p;}});
  assert.equal(await pending,2);
  assert.ok(called.url.endsWith('/rest/v1/rpc/mc_process_due_rounds'));
  assert.equal(called.options.method,'POST');
});

test('scheduled Worker surfaces database failure', async () => {
  const instance=worker(async ()=>new Response(JSON.stringify({message:'timer failed'}),{status:500}));
  let pending;
  await instance.scheduled({}, {SUPABASE_SERVICE_ROLE_KEY:'test-only'}, {waitUntil(p){pending=p;}});
  await assert.rejects(pending,/timer failed/);
});
