export async function onRequestGet(context) {
  const cookieHeader = context.request.headers.get('Cookie');
  const match = cookieHeader?.split(';').find((c) => c.trim().startsWith('session_id='));
  const sessionId = match ? match.split('=')[1]?.trim() : null;

  if (!sessionId) {
    return Response.json({ user: null });
  }

  const { DB } = context.env;
  const user = await DB
    .prepare('SELECT id, email, name, image FROM users WHERE id = ?')
    .bind(sessionId)
    .first();

  return Response.json({ user: user || null });
}
