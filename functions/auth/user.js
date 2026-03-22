// GET /auth/user
// Returns current user data from D1 by email, plus credits info

export async function onRequestGet(context) {
  const cookieHeader = context.request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);

  if (!match) {
    return json({ user: null });
  }

  let sessionData;
  try {
    sessionData = JSON.parse(decodeURIComponent(atob(match[1])));
  } catch {
    return json({ user: null });
  }

  const { DB } = context.env;
  const email = sessionData.email;

  if (!email) {
    return json({ user: null });
  }

  if (!DB) {
    return json({ user: { ...sessionData, credits: 0, plan: null } });
  }

  try {
    const user = await DB.prepare(
      'SELECT id, google_id, email, name, picture, credits, plan_type FROM users WHERE email = ?'
    ).bind(email).first();

    if (user) {
      return json({
        user: {
          id: user.id,
          google_id: user.google_id,
          email: user.email,
          name: user.name,
          image: user.picture || '',
          credits: user.credits ?? 0,
          plan: user.plan_type || 'free'
        }
      });
    }

    // User not found in DB but has session - return cookie data with 0 credits
    return json({ user: { ...sessionData, credits: 0, plan: null } });

  } catch (e) {
    return json({ user: { ...sessionData, credits: 0, plan: null }, error: e.message });
  }
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
