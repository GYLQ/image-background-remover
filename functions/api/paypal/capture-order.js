// POST /api/paypal/capture-order
// Body: { orderID: string, userId: string, packId: string }
// Captures the PayPal order and adds credits to user
// Primary credit mechanism (not webhook-dependent)

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

  const { orderID, userId, packId } = body;
  if (!orderID || !userId) {
    return json({ error: 'orderID and userId required' }, 400);
  }

  const PACKS = {
    starter: { credits: 30 },
    value:   { credits: 200 },
    bulk:    { credits: 1000 },
  };
  const pack = PACKS[packId];
  if (!pack) {
    return json({ error: 'Invalid packId' }, 400);
  }

  const CLIENT_ID = env.PAYPAL_CLIENT_ID;
  const SECRET = env.PAYPAL_SECRET;
  if (!CLIENT_ID || !SECRET) {
    return json({ error: 'PayPal not configured' }, 500);
  }

  // Get access token
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
      return json({ error: 'PayPal auth failed', detail: tokenData.error_description }, 502);
    }
    accessToken = tokenData.access_token;
  } catch (e) {
    return json({ error: 'PayPal network error', detail: e.message }, 502);
  }

  // Verify order status with PayPal
  let orderStatus;
  try {
    const verifyRes = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderID}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'PayPal-Request-Id': `verify_${Date.now()}_${userId}`,
      },
    });
    const orderData = await verifyRes.json();
    if (!verifyRes.ok) {
      return json({ error: 'Failed to verify order', detail: orderData }, 502);
    }
    orderStatus = orderData.status;
    console.log(`Order ${orderID} status: ${orderStatus}`);
  } catch (e) {
    return json({ error: 'Failed to verify order', detail: e.message }, 502);
  }

  // Check if already processed
  const existing = await env.DB.prepare(
    'SELECT status FROM paypal_orders WHERE order_id = ?'
  ).bind(orderID).first();

  if (existing?.status === 'completed') {
    // Already credited - return current balance
    const user = await env.DB.prepare(
      'SELECT credits FROM users WHERE id = ?'
    ).bind(userId).first();
    return json({
      success: true,
      creditsAdded: 0,
      newBalance: user?.credits ?? 0,
      message: 'Already credited'
    });
  }

  // Only capture if PayPal shows COMPLETED or APPROVED
  if (orderStatus === 'COMPLETED' || orderStatus === 'APPROVED') {
    // Add credits
    await env.DB.prepare(
      'UPDATE users SET credits = credits + ? WHERE id = ?'
    ).bind(pack.credits, userId).run();

    // Log usage
    const logId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    await env.DB.prepare(
      'INSERT INTO credit_usage (id, user_id, credits, action, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(logId, userId, pack.credits, `paypal_${packId}`, 0, Date.now()).run();

    // Update or insert order record
    if (existing) {
      await env.DB.prepare(
        'UPDATE paypal_orders SET status = ?, updated_at = ? WHERE order_id = ?'
      ).bind('completed', Date.now(), orderID).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO paypal_orders (order_id, user_id, pack_id, credits, amount_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(orderID, userId, packId, pack.credits, PACKS[packId]?.credits_usd || '0', 'completed', Date.now()).run();
    }

    // Get updated balance
    const user = await env.DB.prepare(
      'SELECT credits FROM users WHERE id = ?'
    ).bind(userId).first();

    return json({
      success: true,
      creditsAdded: pack.credits,
      newBalance: user?.credits ?? 0,
      orderStatus: orderStatus
    });
  }

  return json({
    success: false,
    error: 'Order not completed',
    orderStatus: orderStatus
  }, 400);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
