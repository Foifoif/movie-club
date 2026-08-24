const crypto = require('node:crypto');

const ALLOWED_ACTIONS = new Set([
  'mc_create_round',
  'mc_advance_phase',
  'mc_reopen_phase',
  'mc_open_movie_stage',
  'mc_build_bracket',
  'mc_resolve_matchup',
  'mc_process_due_rounds',
]);

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,x-round-admin-token',
      'access-control-allow-methods': 'POST,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  if (event.httpMethod !== 'POST') return response(405, { error: 'POST required' });

  if (!tokenMatches(event.headers['x-round-admin-token'], process.env.ROUND_ADMIN_TOKEN)) {
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
  return response(upstream.status, upstream.ok ? { data: payload } : { error: payload });
};
