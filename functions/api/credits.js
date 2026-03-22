import { createHash } from 'crypto';

export async function onRequestGet(context) {
  try {
    const { DB } = context.env;
    const clientIP = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = createHash('md5').update(clientIP).digest('hex');
    const today = new Date().toISOString().slice(0, 10);
    
    // Inline session verification
    const cookieHeader = context.request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/session=([^;]+)/);
    let sessionUser = null;
    if (match) {
      try {
        sessionUser = JSON.parse(decodeURIComponent(atob(match[1])));
      } catch {}
    }
    
    let credits = null;
    let type = 'anonymous';
    let remaining = null;
    let limit = 3;
    
    if (sessionUser && DB) {
      const user = await DB.prepare('SELECT credits, plan_type FROM users WHERE email = ?').bind(sessionUser.email).first();
      if (user) {
        credits = user.credits || 0;
        type = user.plan_type === 'free' ? 'free_user' : 'subscriber';
        remaining = credits;
        limit = null;
      }
    } else if (DB) {
      const record = await DB.prepare('SELECT uses FROM ip_daily_usage WHERE ip_hash = ? AND date = ?')
        .bind(ipHash, today).first();
      const uses = record?.uses || 0;
      remaining = Math.max(0, 3 - uses);
      type = 'anonymous';
      limit = 3;
    }
    
    return new Response(JSON.stringify({
      credits: remaining,
      type,
      limit,
      is_free: type === 'anonymous' || (type === 'free_user' && remaining <= 0)
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
