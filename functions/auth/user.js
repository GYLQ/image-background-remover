export async function onRequestGet(context) {
  const cookieHeader = context.request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  
  if (!match) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const sessionData = JSON.parse(atob(match[1]));
    return new Response(JSON.stringify({
      user: {
        id: sessionData.id,
        email: sessionData.email,
        name: sessionData.name,
        image: sessionData.picture,
      }
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
