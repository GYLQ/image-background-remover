export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = context.env;

  // Diagnostic: check environment
  const envKeys = Object.keys(context.env).filter(k => !k.startsWith('__'));
  
  if (!code) {
    return new Response(JSON.stringify({ error: 'No code provided', env: envKeys }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return new Response(JSON.stringify({ 
      error: 'Missing OAuth config', 
      hasClientId: !!GOOGLE_CLIENT_ID, 
      hasClientSecret: !!GOOGLE_CLIENT_SECRET,
      env: envKeys 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redirectUri = GOOGLE_REDIRECT_URI || 'https://imagebackgroudremover.us.ci/auth/callback';

  // Exchange code for tokens
  let tokenRes;
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Token fetch failed', msg: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(JSON.stringify({ error: 'Token exchange failed', detail: err }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let tokens;
  try {
    tokens = await tokenRes.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to parse token response' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const accessToken = tokens.access_token;
  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'No access token', tokens }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get Google user info
  let userInfo;
  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    userInfo = await userRes.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to get user info', msg: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Store user info in cookie
  const sessionData = btoa(JSON.stringify({
    id: userInfo.sub || Math.random().toString(36).slice(2),
    email: userInfo.email,
    name: userInfo.name || userInfo.email,
    picture: userInfo.picture || '',
  }));

  const cookie = `session=${sessionData}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
  return new Response(null, {
    status: 302,
    headers: { Location: '/', 'Set-Cookie': cookie },
  });
}
