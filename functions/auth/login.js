export async function onRequestGet(context) {
  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = context.env;
  const state = btoa(JSON.stringify({ ts: Date.now(), nonce: crypto.randomUUID() }));
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
