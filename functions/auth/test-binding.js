export async function onRequestGet(context) {
  const env = Object.keys(context.env).filter(k => !k.startsWith('__'));
  try {
    const { DB } = context.env;
    if (!DB) {
      return new Response(JSON.stringify({ db_bound: false, env }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const result = await DB.prepare('SELECT 1 as test').run();
    return new Response(JSON.stringify({ db_bound: true, result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ db_bound: false, error: err.message, env }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
