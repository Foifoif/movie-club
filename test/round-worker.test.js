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

const env = {ROUND_ADMIN_TOKEN:'test-admin', SUPABASE_SERVICE_ROLE_KEY:'test-service'};
function adminRequest(body, headers = {}) {
  return new Request('https://example.com/api/round-admin', {
    method:'POST', headers:{'content-type':'application/json', ...headers}, body:JSON.stringify(body),
  });
}

test('admin authentication blocks forwarding and tolerates malformed cookies', async () => {
  const instance=worker(async ()=>{throw new Error('must not forward');});
  const response=await instance.fetch(adminRequest({action:'mc_advance_phase'}, {cookie:'mc_round_admin=%ZZ'}),env);
  assert.equal(response.status,401);
});

test('authorized admin forwards arguments and establishes a secure session', async () => {
  let forwarded;
  const instance=worker(async (url, options)=>{
    forwarded={url,options};
    return new Response(JSON.stringify('phase-id'));
  });
  const response=await instance.fetch(adminRequest({action:'mc_advance_phase',args:{p_phase_id:'phase-id'}},{'x-round-admin-token':env.ROUND_ADMIN_TOKEN}),env);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{data:'phase-id'});
  assert.deepEqual(JSON.parse(forwarded.options.body),{p_phase_id:'phase-id'});
  assert.ok(forwarded.url.endsWith('/rpc/mc_advance_phase'));
  assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
});

test('saved admin session works and database errors remain visible', async () => {
  const instance=worker(async ()=>new Response(JSON.stringify({message:'phase already closed'}),{status:400}));
  const response=await instance.fetch(adminRequest({action:'mc_advance_phase'},{cookie:'mc_round_admin=test-admin'}),env);
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:{message:'phase already closed'}});
});

test('network failure tells admin to check state before retrying', async () => {
  const instance=worker(async ()=>{throw new Error('connection reset');});
  const response=await instance.fetch(adminRequest({action:'mc_advance_phase'},{'x-round-admin-token':'test-admin'}),env);
  assert.equal(response.status,502);
  assert.match((await response.json()).error,/may have completed/);
});

test('null action body is rejected and preflight has no response body', async () => {
  const instance=worker(async ()=>{throw new Error('must not forward');});
  const invalid=await instance.fetch(adminRequest(null,{'x-round-admin-token':'test-admin'}),env);
  assert.equal(invalid.status,400);
  const preflight=await instance.fetch(new Request('https://example.com/api/round-admin',{method:'OPTIONS'}),env);
  assert.equal(preflight.status,204);
  assert.equal(await preflight.text(),'');
});

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
