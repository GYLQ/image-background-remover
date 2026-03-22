export async function onRequestGet(context) {
  const cookie = `session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
  return new Response(null, {
    status: 302,
    headers: { Location: '/', 'Set-Cookie': cookie },
  });
}
