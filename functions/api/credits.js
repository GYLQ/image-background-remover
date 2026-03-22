// GET /api/credits - 获取当前用户积分
// POST /api/credits - 设置积分 (需要 X-Admin-Key header)
// body: { userId, amount, action: 'set'|'add'|'deduct' }

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const sessionCookie = getCookie(request, 'session');
    if (!sessionCookie) {
      return json({ credits: 0, isLoggedIn: false });
    }

    const user = parseSession(sessionCookie);
    if (!user?.id) {
      return json({ credits: 0, isLoggedIn: false });
    }

    try {
      const result = await env.DB.prepare(
        'SELECT credits FROM users WHERE id = ?'
      ).bind(user.id).first();
      return json({
        credits: result?.credits ?? 0,
        isLoggedIn: true,
        user: { name: user.name, email: user.email, picture: user.picture }
      });
    } catch (e) {
      return json({ credits: 0, isLoggedIn: false, error: e.message });
    }
  }

  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { userId, amount, action } = body;
    if (!userId || amount === undefined) {
      return json({ error: 'userId and amount required' }, 400);
    }

    // 简单的 admin key 验证
    const adminKey = request.headers.get('X-Admin-Key');
    if (adminKey !== env.ADMIN_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }

    try {
      if (action === 'set') {
        await env.DB.prepare('UPDATE users SET credits = ? WHERE id = ?')
          .bind(amount, userId).run();
      } else if (action === 'add') {
        await env.DB.prepare('UPDATE users SET credits = credits + ? WHERE id = ?')
          .bind(amount, userId).run();
      } else if (action === 'deduct') {
        const before = await env.DB.prepare('SELECT credits FROM users WHERE id = ?')
          .bind(userId).first();
        if (!before || before.credits < amount) {
          return json({ success: false, error: 'Insufficient credits' }, 400);
        }
        await env.DB.prepare('UPDATE users SET credits = credits - ? WHERE id = ?')
          .bind(amount, userId).run();
      } else {
        return json({ error: 'Invalid action' }, 400);
      }

      const updated = await env.DB.prepare('SELECT credits FROM users WHERE id = ?')
        .bind(userId).first();
      return json({ success: true, credits: updated?.credits ?? 0 });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

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
