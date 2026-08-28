const ALLOWED_ACTIONS = new Set([
  'mc_create_round',
  'mc_advance_phase',
  'mc_reopen_phase',
  'mc_open_movie_stage',
  'mc_build_bracket',
  'mc_build_bracket_immediate',
  'mc_resolve_matchup',
  'mc_process_due_rounds',
  'mc_undo_last_round_result',
  'mc_archive_round',
]);

const DEFAULT_SUPABASE_URL = 'https://schtizxdezxteulbvynp.supabase.co';
const ADMIN_COOKIE = 'mc_round_admin';

function tokenMatches(received, expected) {
  if (!received || !expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function cookieValue(cookieHeader, name) {
  const match = String(cookieHeader || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = origin && new URL(request.url).origin === origin ? origin : new URL(request.url).origin;
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type,x-round-admin-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    vary: 'Origin',
  };
}

function json(request, status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

async function callSupabase(env, functionName, args = {}) {
  const response = await fetch(`${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  return { response, payload };
}

async function handleAdmin(request, env) {
  const expectedToken = env.ROUND_ADMIN_TOKEN;
  if (!expectedToken || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(request, 500, { error: 'Cloudflare Worker secrets are not configured' });
  }

  const headerToken = request.headers.get('x-round-admin-token') || '';
  const cookieToken = cookieValue(request.headers.get('cookie'), ADMIN_COOKIE);
  const authenticated = tokenMatches(headerToken, expectedToken) || tokenMatches(cookieToken, expectedToken);

  if (request.method === 'GET') return json(request, 200, { authenticated });
  if (request.method !== 'POST') return json(request, 405, { error: 'POST required' });
  if (!authenticated) return json(request, 401, { error: 'Invalid admin token' });

  let body;
  try { body = await request.json(); } catch { return json(request, 400, { error: 'Invalid JSON' }); }
  if (!ALLOWED_ACTIONS.has(body.action)) return json(request, 400, { error: 'Action not allowed' });

  const { response, payload } = await callSupabase(env, body.action, body.args || {});
  const headers = {};
  if (response.ok) {
    headers['set-cookie'] = `${ADMIN_COOKIE}=${encodeURIComponent(expectedToken)}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`;
  }
  return json(request, response.status, response.ok ? { data: payload } : { error: payload }, headers);
}

async function processDueRounds(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  const { response, payload } = await callSupabase(env, 'mc_process_due_rounds');
  if (!response.ok) throw new Error(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return payload;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json(request, 204, {});
    if (url.pathname === '/.netlify/functions/round-admin' || url.pathname === '/api/round-admin') {
      return handleAdmin(request, env);
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(processDueRounds(env));
  },
};
