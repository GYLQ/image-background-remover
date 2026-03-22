// POST /api/paypal/create-order
// Body: { packId: 'starter'|'value'|'bulk', userId: string }
// Returns: { orderID: string }

export async function onRequestPost(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { packId, userId } = body;
  if (!packId || !userId) {
    return json({ error: 'packId and userId required' }, 400);
  }

  // Credit pack definitions (amount in USD cents)
  const PACKS = {
    starter: { name: '体验包 30积分', credits: 30, usd: '6.00' },
    value:   { name: '超值包 200积分', credits: 200, usd: '30.00' },
    bulk:    { name: '畅用包 1000积分', credits: 1000, usd: '100.00' },
  };

  const pack = PACKS[packId];
  if (!pack) {
    return json({ error: 'Invalid packId' }, 400);
  }

  // Get PayPal credentials
  const CLIENT_ID = env.PAYPAL_CLIENT_ID;
  const SECRET = env.PAYPAL_SECRET;
  if (!CLIENT_ID || !SECRET) {
    return json({ error: 'PayPal not configured' }, 500);
  }

  // Get user from DB to verify existence
  let user;
  try {
    user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(userId).first();
  } catch (e) {
    return json({ error: 'Database error', detail: e.message }, 500);
  }
  if (!user) {
    return json({ error: 'User not found' }, 404);
  }

  // Get PayPal access token
  let accessToken;
  try {
    const creds = btoa(`${CLIENT_ID}:${SECRET}`);
    const tokenRes = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return json({ error: 'PayPal auth failed', detail: tokenData }, 502);
    }
    accessToken = tokenData.access_token;
  } catch (e) {
    return json({ error: 'PayPal network error', detail: e.message }, 502);
  }

  // Create PayPal order
  const paypalOrder = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: `pack_${packId}_user_${userId}`,
      description: pack.name,
      amount: {
        currency_code: 'USD',
        value: pack.usd,
      },
      custom_id: JSON.stringify({ packId, userId }),
    }],
    application_context: {
      brand_name: 'BG Remover',
      landing_page: 'NO_PREFERENCE',
      user_action: 'PAY_NOW',
      return_url: `${new URL(request.url).origin}/pricing?payment=success`,
      cancel_url: `${new URL(request.url).origin}/pricing?payment=cancelled`,
    },
  };

  let paypalRes;
  try {
    paypalRes = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `order_${Date.now()}_${userId}`,
      },
      body: JSON.stringify(paypalOrder),
    });
    const orderData = await paypalRes.json();

    if (!paypalRes.ok) {
      return json({ error: 'PayPal order creation failed', detail: orderData }, 502);
    }

    // Store order in D1 for verification tracking
    const orderId = orderData.id;
    try {
      await env.DB.prepare(
        'INSERT INTO paypal_orders (order_id, user_id, pack_id, credits, amount_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(orderId, userId, packId, pack.credits, pack.usd, 'created', Date.now()).run();
    } catch (e) {
      // Non-fatal - continue even if DB insert fails
      console.error('Failed to store order:', e.message);
    }

    return json({ orderID: orderId, status: orderData.status });
  } catch (e) {
    return json({ error: 'PayPal request failed', detail: e.message }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
