export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const { DB, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = context.env;

  if (!code) {
    return new Response(JSON.stringify({ error: 'No code provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!DB) {
    return new Response(JSON.stringify({ error: 'DB not bound', env: Object.keys(context.env) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return new Response(JSON.stringify({ error: 'Missing OAuth config', GOOGLE_CLIENT_ID: !!GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: !!GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI: !!GOOGLE_REDIRECT_URI }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: GOOGLE_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return new Response(JSON.stringify({ error: 'Token exchange failed', detail: err }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;

    // Get Google user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = await userRes.json();

    // Upsert user in D1
    const existing = await DB
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(userInfo.email)
      .first();

    let userId;
    if (existing) {
      userId = existing.id;
      await DB
        .prepare('UPDATE users SET name = ?, image = ? WHERE id = ?')
        .bind(userInfo.name || userInfo.email, userInfo.picture || '', userId)
        .run();
    } else {
      userId = crypto.randomUUID();
      await DB
        .prepare('INSERT INTO users (id, email, name, image, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, userInfo.email, userInfo.name || userInfo.email, userInfo.picture || '', Date.now())
        .run();
    }

    // Set session cookie and redirect to home
    const cookie = `session_id=${userId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Set-Cookie': cookie },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
