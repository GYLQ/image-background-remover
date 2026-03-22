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

    // Generate session ID (used as user ID)
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const googleId = userInfo.sub || sessionId;

    // Store or update user in D1
    console.log('Callback: DB available:', !!DB, 'googleId:', googleId, 'email:', userInfo.email);
    if (DB) {
      // Check if user already exists by google_id
      const existing = await DB.prepare('SELECT id, credits FROM users WHERE google_id = ?').bind(googleId).first();
      console.log('Callback: existing user:', existing ? 'yes (id=' + existing.id + ')' : 'no');
      if (existing) {
        // Returning user - update info, keep existing credits
        await DB.prepare('UPDATE users SET email = ?, name = ?, picture = ?, last_login = ? WHERE google_id = ?')
          .bind(userInfo.email, userInfo.name || userInfo.email, userInfo.picture || '', Date.now(), googleId)
          .run();
      } else {
        // New user - INSERT with 3 credits
        await DB.prepare('INSERT INTO users (id, google_id, email, name, picture, credits, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(sessionId, googleId, userInfo.email, userInfo.name || userInfo.email, userInfo.picture || '', 3, Date.now(), Date.now())
          .run();
        console.log('Callback: INSERTED new user with 3 credits');
      }
    } else {
      console.log('Callback: DB is NOT available!');
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
