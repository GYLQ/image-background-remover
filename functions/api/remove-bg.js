import { createHash } from 'crypto';

const REMOVE_BG_API = 'https://api.remove.bg/v1.0/removebg';
const API_KEY = 'BsjaePtc6Vy2jhWZcJkJg71H';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function hashIP(ip) {
  return createHash('md5').update(ip || 'unknown').digest('hex');
}

async function verifySession(context) {
  const cookieHeader = context.request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(atob(match[1])));
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  try {
    const { DB, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = context.env;
    const clientIP = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = hashIP(clientIP);
    const today = new Date().toISOString().slice(0, 10);
    
    // === CREDIT CHECK ===
    const sessionUser = await verifySession(context);
    
    if (sessionUser && DB) {
      // Logged-in user: check credits
      const user = await DB.prepare('SELECT credits, plan_type FROM users WHERE email = ?').bind(sessionUser.email).first();
      
      if (!user) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      const credits = user.credits || 0;
      
      if (credits <= 0) {
        return new Response(JSON.stringify({
          error: 'no_credits',
          message: '积分不足，请升级或购买积分包',
          remaining: 0,
          type: user.plan_type
        }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else if (DB) {
      // Anonymous user: check IP daily limit (3/day)
      const record = await DB.prepare('SELECT uses FROM ip_daily_usage WHERE ip_hash = ? AND date = ?')
        .bind(ipHash, today).first();
      const uses = record?.uses || 0;
      
      if (uses >= 3) {
        return new Response(JSON.stringify({
          error: 'daily_limit',
          message: '今日免费次数已用完，请登录或注册获取更多积分',
          remaining: 0,
          type: 'anonymous'
        }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // === PARSE FORM DATA ===
    const formData = await context.request.formData();
    const imageFile = formData.get('image');
    const outputFormat = formData.get('format') || 'png';
    
    if (!imageFile) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (imageFile.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large. Max 5MB.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      return new Response(JSON.stringify({ error: 'Unsupported format. Use JPEG, PNG, or WebP.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // === CALL REMOVE.BG API ===
    const arrayBuffer = await imageFile.arrayBuffer();
    const bgRemovalForm = new FormData();
    bgRemovalForm.append('image_file', imageFile);
    bgRemovalForm.append('size', 'auto');
    bgRemovalForm.append('format', outputFormat);
    
    const response = await fetch(REMOVE_BG_API, {
      method: 'POST',
      headers: { 'Authorization': API_KEY },
      body: bgRemovalForm,
    });
    
    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: 'Background removal failed', detail: err }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const resultBuffer = await response.arrayBuffer();
    
    // === DEDUCT CREDITS ===
    if (DB) {
      if (sessionUser) {
        // Deduct from user credits
        await DB.prepare('UPDATE users SET credits = credits - 1 WHERE email = ?').bind(sessionUser.email).run();
        await DB.prepare('INSERT INTO credit_usage (id, user_id, credits, action, file_size, created_at) VALUES (?, ?, 1, ?, ?, ?)')
          .bind(
            crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
            sessionUser.email, 'remove_bg', imageFile.size, Date.now()
          ).run();
      } else {
        // Increment IP usage
        const existing = await DB.prepare('SELECT uses FROM ip_daily_usage WHERE ip_hash = ? AND date = ?')
          .bind(ipHash, today).first();
        if (existing) {
          await DB.prepare('UPDATE ip_daily_usage SET uses = uses + 1 WHERE ip_hash = ? AND date = ?')
            .bind(ipHash, today).run();
        } else {
          await DB.prepare('INSERT INTO ip_daily_usage (ip_hash, date, uses) VALUES (?, ?, 1)')
            .bind(ipHash, today).run();
        }
        await DB.prepare('INSERT INTO credit_usage (id, ip_hash, credits, action, file_size, created_at) VALUES (?, ?, 1, ?, ?, ?)')
          .bind(
            crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
            ipHash, 'remove_bg', imageFile.size, Date.now()
          ).run();
      }
    }
    
    // === RETURN RESULT ===
    const contentType = outputFormat === 'jpeg' ? 'image/jpeg' : outputFormat === 'webp' ? 'image/webp' : 'image/png';
    
    // Get remaining credits for response
    let remaining = null;
    if (DB) {
      if (sessionUser) {
        const user = await DB.prepare('SELECT credits FROM users WHERE email = ?').bind(sessionUser.email).first();
        remaining = user?.credits || 0;
      } else {
        const record = await DB.prepare('SELECT uses FROM ip_daily_usage WHERE ip_hash = ? AND date = ?')
          .bind(ipHash, today).first();
        remaining = Math.max(0, 3 - (record?.uses || 0));
      }
    }
    
    return new Response(resultBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'X-Credits-Remaining': String(remaining),
        'X-Credit-Type': sessionUser ? 'user' : 'anonymous',
        'Cache-Control': 'no-store',
      },
    });
    
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
