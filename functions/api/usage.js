// GET /api/usage?userId=xxx&date=YYYY-MM-DD
// Returns usage stats for a user

function parseSession(cookie) {
  try {
    return JSON.parse(decodeURIComponent(cookie));
  } catch {
    return null;
  }
}

function getCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  for (const cookie of cookies.split(';')) {
    const [k, v] = cookie.trim().split('=');
    if (k === name) return v;
  }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const dateParam = url.searchParams.get('date'); // YYYY-MM-DD

  if (!userId) {
    return json({ error: 'userId required' }, 400);
  }

  const today = dateParam || new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  try {
    // Today's usage
    const todayRows = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM credit_usage WHERE user_id = ? AND action = 'remove_bg' AND datetime(created_at/1000, 'unixepoch') = ?"
    ).bind(userId, today).all();

    const todayCount = todayRows.results?.[0]?.count ?? 0;

    // This month's usage
    const monthRows = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM credit_usage WHERE user_id = ? AND action = 'remove_bg' AND datetime(created_at/1000, 'unixepoch') >= ?"
    ).bind(userId, monthStart).all();

    const monthCount = monthRows.results?.[0]?.count ?? 0;

    // Total usage
    const totalRows = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM credit_usage WHERE user_id = ? AND action = 'remove_bg'"
    ).bind(userId).all();

    const totalCount = totalRows.results?.[0]?.count ?? 0;

    // Recent usage (last 10)
    const recentRows = await env.DB.prepare(
      "SELECT credits, action, file_size, created_at FROM credit_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
    ).bind(userId).all();

    return json({
      today: todayCount,
      month: monthCount,
      total: totalCount,
      recent: recentRows.results || []
    });
  } catch (e) {
    return json({ today: 0, month: 0, total: 0, recent: [], error: e.message });
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
