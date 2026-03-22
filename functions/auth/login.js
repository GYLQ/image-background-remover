export async function onRequestGet(context) {
  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = context.env;
  
  // Generate state with simple random string (no crypto.randomUUID needed)
  const randomPart = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const state = btoa(JSON.stringify({ ts: Date.now(), nonce: randomPart }));
  
  const redirectUri = GOOGLE_REDIRECT_URI || 'https://imagebackgroudremover.us.ci/auth/callback';
  const clientId = GOOGLE_CLIENT_ID || '546833860005-os34ijqo5c5vf5pq3iafktink7n3a7o9.apps.googleusercontent.com';
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}
