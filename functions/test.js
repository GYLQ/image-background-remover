export async function onRequestGet(context) {
  return new Response('OK from functions', { status: 200 });
}
