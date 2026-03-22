export async function onRequestGet(context) {
  try {
    const cookieHeader = context.request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/session=([^;]+)/);
    
    if (!match) {
      return new Response(JSON.stringify({ user: null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let sessionData;
    try {
      sessionData = JSON.parse(decodeURIComponent(atob(match[1])));
    } catch {
      return new Response(JSON.stringify({ user: null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Try to get fresh data from D1
    const { DB } = context.env;
    if (DB && sessionData.email) {
      const user = await DB.prepare('SELECT id, email, name, image FROM users WHERE email = ?')
        .bind(sessionData.email)
        .first();
      if (user) {
        return new Response(JSON.stringify({ user }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Fall back to cookie data
    return new Response(JSON.stringify({ user: sessionData }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ user: null, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
