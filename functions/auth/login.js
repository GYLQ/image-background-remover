export async function onRequestGet(context) {
  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = context.env;
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    return new Response(JSON.stringify({ error: 'OAuth config missing', hasClientId: !!GOOGLE_CLIENT_ID, hasRedirectUri: !!GOOGLE_REDIRECT_URI }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  const randomPart = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const state = btoa(JSON.stringify({ ts: Date.now(), nonce: randomPart }));
  
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}
