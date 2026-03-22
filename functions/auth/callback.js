export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = context.env;

  if (!code) {
    return new Response(JSON.stringify({ error: 'No code provided' }), {
      status: 400,
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

  // Get Google user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userInfo = await userRes.json();

  // Store user info in cookie (base64 encoded JSON, not sensitive since it's from Google)
  const sessionData = btoa(JSON.stringify({
    id: userInfo.sub || crypto.randomUUID(),
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
