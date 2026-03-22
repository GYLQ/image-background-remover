export async function onRequestGet() {
  const cookie = `session_id=; HttpOnly; Path=/; Max-Age=0`;
  return new Response(null, {
    status: 302,
    headers: { Location: '/', 'Set-Cookie': cookie },
  });
}
