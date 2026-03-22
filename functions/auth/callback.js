export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const code = url.searchParams.get('code');
    const { DB, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = context.env;

    if (!code) {
      return new Response(JSON.stringify({ error: 'No code provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: 'OAuth config missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const redirectUri = GOOGLE_REDIRECT_URI || 'https://imagebackgroudremover.us.ci/auth/callback';

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
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

    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'No access token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get Google user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = await userRes.json();

    if (!userInfo.email) {
      return new Response(JSON.stringify({ error: 'No email in user info' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Generate session ID
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    // Store or update user in D1 (matching actual schema: id, google_id, email, name, picture, created_at, last_login)
    if (DB) {
      const existing = await DB.prepare('SELECT id FROM users WHERE email = ?').bind(userInfo.email).first();
      if (existing) {
        await DB.prepare('UPDATE users SET name = ?, picture = ?, last_login = ? WHERE email = ?')
          .bind(userInfo.name || userInfo.email, userInfo.picture || '', Date.now(), userInfo.email)
          .run();
      } else {
        await DB.prepare('INSERT INTO users (id, google_id, email, name, picture, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(sessionId, userInfo.sub || sessionId, userInfo.email, userInfo.name || userInfo.email, userInfo.picture || '', Date.now(), Date.now())
          .run();
      }
    }

    // Create session data for cookie (store email as identifier)
    const sessionData = {
      id: sessionId,
      email: userInfo.email,
      name: userInfo.name || userInfo.email,
      picture: userInfo.picture || '',
    };

    const encodedSession = btoa(encodeURIComponent(JSON.stringify(sessionData)));
    const cookie = `session=${encodedSession}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': cookie,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
