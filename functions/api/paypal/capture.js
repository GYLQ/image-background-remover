// POST /api/paypal/capture-order
// Body: { orderID: string, userId: string, packId: string }
// Captures the PayPal order and adds credits to user

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
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;
  } catch (e) {
    return json({ error: 'PayPal auth failed', detail: e.message }, 502);
  }

  // Capture the order
  let captureRes;
  try {
    captureRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `capture_${Date.now()}_${userId}`,
      },
    });
    const captureData = await captureRes.json();

    if (!captureRes.ok) {
      return json({ error: 'PayPal capture failed', detail: captureData }, 502);
    }

    if (captureData.status !== 'COMPLETED') {
      return json({ error: 'Order not completed', status: captureData.status }, 400);
    }

    // Check if already processed
    const existing = await env.DB.prepare(
      'SELECT status FROM paypal_orders WHERE order_id = ?'
    ).bind(orderID).first();

    if (!existing) {
      return json({ error: 'Order not found in database' }, 404);
    }

    if (existing.status === 'completed') {
      return json({ error: 'Order already processed', credits: 0 }, 400);
    }

    // Add credits to user
    await env.DB.prepare(
      'UPDATE users SET credits = credits + ? WHERE id = ?'
    ).bind(pack.credits, userId).run();

    // Log usage
    await env.DB.prepare(
      'INSERT INTO credit_usage (id, user_id, credits, action, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      userId, pack.credits, `paypal_${packId}`, 0, Date.now()
    ).run();

    // Update order status
    await env.DB.prepare(
      'UPDATE paypal_orders SET status = ?, updated_at = ? WHERE order_id = ?'
    ).bind('completed', Date.now(), orderID).run();

    // Get updated credit balance
    const user = await env.DB.prepare(
      'SELECT credits FROM users WHERE id = ?'
    ).bind(userId).first();

    return json({
      success: true,
      creditsAdded: pack.credits,
      newBalance: user?.credits ?? 0,
      transactionId: captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id,
    });

  } catch (e) {
    return json({ error: 'Capture failed', detail: e.message }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
