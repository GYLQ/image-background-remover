// Cloudflare Pages Function: POST /api/remove-bg
// Handles image upload, credit checking, and remove.bg API call

const REMOVE_BG_API = 'https://api.remove.bg/v1.0/removebg';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Simple async hash using Web Crypto API (available in Cloudflare Workers)
async function hashIP(ip) {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip || 'unknown');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple UUID generator (Web Crypto based, works in Cloudflare Workers)
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function verifySession(context) {
  const cookieHeader = context.request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  try {
    const { env } = context;
    const clientIP = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await hashIP(clientIP);
    const today = new Date().toISOString().slice(0, 10);

    // === CREDIT CHECK ===
    const sessionUser = await verifySession(context);
    const DB = env.DB;
    const REMOVE_BG_API_KEY = env.REMOVE_BG_API_KEY;

    if (sessionUser && DB) {
      // Logged-in user: check credits
      const user = await DB.prepare(
        'SELECT credits, plan_type FROM users WHERE id = ?'
      ).bind(sessionUser.id).first();

      if (!user) {
        return jsonResp({ error: 'User not found' }, 401);
      }

      const credits = user.credits ?? 0;

      if (credits <= 0) {
        return jsonResp({
          error: 'no_credits',
          message: '积分不足，请升级或购买积分包',
          remaining: 0,
          type: user.plan_type || 'free'
        }, 402);
      }
    } else if (DB) {
      // Anonymous user: 3 uses per day via IP hash
      const record = await DB.prepare(
        'SELECT uses FROM ip_daily_usage WHERE ip_hash = ? AND date = ?'
      ).bind(ipHash, today).first();
      const uses = record?.uses ?? 0;

      if (uses >= 3) {
        return jsonResp({
          error: 'daily_limit',
          message: '今日免费次数已用完（3次/天），请登录获取更多积分',
          remaining: 0,
          type: 'anonymous'
        }, 402);
      }
    }

    // === PARSE FORM DATA ===
    const formData = await context.request.formData();
    const imageFile = formData.get('image');
    const outputFormat = formData.get('format') || 'png';

    if (!imageFile) {
      return jsonResp({ error: 'No image provided' }, 400);
    }

    if (imageFile.size > MAX_FILE_SIZE) {
      return jsonResp({ error: 'File too large. Max 5MB.' }, 400);
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      return jsonResp({ error: 'Unsupported format. Use JPEG, PNG, or WebP.' }, 400);
    }

    // === CALL REMOVE.BG API ===
    const bgRemovalForm = new FormData();
    bgRemovalForm.append('image_file', imageFile);
    bgRemovalForm.append('size', 'auto');
    bgRemovalForm.append('format', outputFormat);

    const response = await fetch(REMOVE_BG_API, {
      method: 'POST',
      headers: { 'X-Api-Key': REMOVE_BG_API_KEY },
      body: bgRemovalForm,
    });

    if (!response.ok) {
      const err = await response.text();
      return jsonResp({ error: 'Background removal failed', detail: err }, 502);
    }

    const resultBuffer = await response.arrayBuffer();

    // === DEDUCT CREDITS ===
    if (DB) {
      if (sessionUser) {
        await DB.prepare('UPDATE users SET credits = credits - 1 WHERE id = ?')
          .bind(sessionUser.id).run();
        await DB.prepare(
          'INSERT INTO credit_usage (id, user_id, credits, action, file_size, created_at) VALUES (?, ?, 1, ?, ?, ?)'
        ).bind(generateId(), sessionUser.id, 'remove_bg', imageFile.size, Date.now()).run();
      } else {
        const existing = await DB.prepare(
          'SELECT uses FROM ip_daily_usage WHERE ip_hash = ? AND date = ?'
        ).bind(ipHash, today).first();
        if (existing) {
          await DB.prepare('UPDATE ip_daily_usage SET uses = uses + 1 WHERE ip_hash = ? AND date = ?')
            .bind(ipHash, today).run();
        } else {
          await DB.prepare('INSERT INTO ip_daily_usage (ip_hash, date, uses) VALUES (?, ?, 1)')
            .bind(ipHash, today).run();
        }
        await DB.prepare(
          'INSERT INTO credit_usage (id, ip_hash, credits, action, file_size, created_at) VALUES (?, ?, 1, ?, ?, ?)'
        ).bind(generateId(), ipHash, 'remove_bg', imageFile.size, Date.now()).run();
      }
    }

    // === RETURN RESULT ===
    const contentType = outputFormat === 'jpeg' ? 'image/jpeg'
      : outputFormat === 'webp' ? 'image/webp'
      : 'image/png';

    let remaining = null;
    if (DB) {
      if (sessionUser) {
        const user = await DB.prepare('SELECT credits FROM users WHERE id = ?')
          .bind(sessionUser.id).first();
        remaining = user?.credits ?? 0;
      } else {
        const record = await DB.prepare(
          'SELECT uses FROM ip_daily_usage WHERE ip_hash = ? AND date = ?'
        ).bind(ipHash, today).first();
        remaining = Math.max(0, 3 - (record?.uses ?? 0));
      }
    }

    return new Response(resultBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'X-Credits-Remaining': String(remaining ?? 'N/A'),
        'X-Credit-Type': sessionUser ? 'user' : 'anonymous',
        'Cache-Control': 'no-store',
      },
    });

  } catch (err) {
    return jsonResp({ error: 'Internal error', message: err.message }, 500);
  }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
