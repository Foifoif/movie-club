exports.config = { schedule: '*/5 * * * *' };

exports.handler = async function handler() {
  const url = process.env.SUPABASE_URL || 'https://schtizxdezxteulbvynp.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { statusCode: 500, body: 'SUPABASE_SERVICE_ROLE_KEY is not configured' };

  const response = await fetch(`${url}/rest/v1/rpc/mc_process_due_rounds`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const body = await response.text();
  return { statusCode: response.ok ? 200 : response.status, body };
};
