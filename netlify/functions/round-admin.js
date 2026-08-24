const crypto = require('node:crypto');

const ALLOWED_ACTIONS = new Set([
  'mc_create_round',
  'mc_advance_phase',
  'mc_reopen_phase',
  'mc_open_movie_stage',
  'mc_build_bracket',
  'mc_resolve_matchup',
  'mc_process_due_rounds',
  'mc_undo_last_round_result',
]);

function response(statusCode, body, cookie) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,x-round-admin-token',
      'access-control-allow-methods': 'POST,OPTIONS',
      ...(cookie ? { 'set-cookie': cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

function cookieValue(cookieHeader, name) {
  const match = String(cookieHeader || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  const expectedToken = process.env.ROUND_ADMIN_TOKEN;
  const headerToken = event.headers?.['x-round-admin-token'] || event.headers?.['X-Round-Admin-Token'];
  const cookieToken = cookieValue(event.headers?.cookie, 'mc_round_admin');
  const authenticated = tokenMatches(headerToken, expectedToken) || tokenMatches(cookieToken, expectedToken);

  if (event.httpMethod === 'GET') return response(200, { authenticated });
  if (event.httpMethod !== 'POST') return response(405, { error: 'POST required' });

  if (!authenticated) {
    return response(401, { error: 'Invalid admin token' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return response(400, { error: 'Invalid JSON' }); }
  if (!ALLOWED_ACTIONS.has(body.action)) return response(400, { error: 'Action not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || 'https://schtizxdezxteulbvynp.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return response(500, { error: 'Supabase service key is not configured' });

  const upstream = await fetch(`${supabaseUrl}/rest/v1/rpc/${body.action}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body.args || {}),
  });
  const text = await upstream.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  const sessionCookie = upstream.ok
    ? `mc_round_admin=${encodeURIComponent(expectedToken)}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`
    : null;
  return response(upstream.status, upstream.ok ? { data: payload } : { error: payload }, sessionCookie);
};
