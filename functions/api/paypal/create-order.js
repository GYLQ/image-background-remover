// POST /api/paypal/create-order
// Body (one-time):   { packId: 'starter'|'value'|'bulk', userId: string }
// Body (subscription): { subscriptionPlanId: 'basic'|'pro'|'team', userId: string }
// Returns (one-time):    { orderID: string, status: string }
// Returns (subscription): { subscriptionID: string, status: string, approvalURL: string }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

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

  const { packId, subscriptionPlanId, userId } = body;

  // ── SUBSCRIPTION flow ──────────────────────────────────────────────────────
  if (subscriptionPlanId) {
    const PLANS = {
      basic: { name: 'BG Remover Basic', credits: 60, usd: '1.35' },
      pro:   { name: 'BG Remover Pro',   credits: 200, usd: '3.95' },
      team:  { name: 'BG Remover Team', credits: 800, usd: '13.50' },
    };

    const plan = PLANS[subscriptionPlanId];
    if (!plan) {
      return json({ error: 'Invalid subscriptionPlanId' }, 400);
    }
    if (!userId) {
      return json({ error: 'userId required' }, 400);
    }

    const CLIENT_ID = env.PAYPAL_CLIENT_ID;
    const SECRET    = env.PAYPAL_SECRET;
    if (!CLIENT_ID || !SECRET) {
      return json({ error: 'PayPal not configured' }, 500);
    }

    // Verify user
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
      const creds   = btoa(`${CLIENT_ID}:${SECRET}`);
      const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${creds}`,
          'Content-Type':  'application/x-www-form-urlencoded',
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

    // Create PayPal subscription
    try {
      const subRes = await fetch('https://api-m.paypal.com/v1/billing/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization':  `Bearer ${accessToken}`,
          'Content-Type':   'application/json',
          'PayPal-Request-Id': `sub_${Date.now()}_${userId}`,
        },
        body: JSON.stringify({
          intent: 'SUBSCRIBE',
          subscriber: {
            email_address: user.email,
            name: {
              given_name: (user.name || user.email || 'User').split(' ')[0],
              surname:    (user.name || '').split(' ').slice(1).join(' ') || 'User',
            },
          },
          plan: { plan_id: `BGREMOVER_${subscriptionPlanId.toUpperCase()}` },
          application_context: {
            brand_name:   'BG Remover',
            landing_page:  'NO_PREFERENCE',
            user_action:  'SUBSCRIBE_NOW',
            return_url:    `${new URL(request.url).origin}/profile`,
            cancel_url:    `${new URL(request.url).origin}/pricing`,
          },
        }),
      });
      const subData = await subRes.json();

      if (!subRes.ok) {
        return json({ error: 'Subscription creation failed', detail: subData.error || subData.message }, 502);
      }

      // Store in D1
      try {
        await env.DB.prepare(
          'INSERT INTO paypal_subscriptions (subscription_id, user_id, plan_id, credits, amount_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(subData.id, userId, subscriptionPlanId, plan.credits, plan.usd, 'PENDING', Date.now()).run();
      } catch (e) {
        console.error('Failed to store subscription:', e.message);
      }

      const approvalLink = subData.links?.find(l => l.rel === 'approve');
      return json({
        subscriptionID: subData.id,
        status:        subData.status,
        approvalURL:   approvalLink?.href,
      });

    } catch (e) {
      return json({ error: 'Subscription request failed', detail: e.message }, 502);
    }
  }

  // ── ONE-TIME PAYMENT flow ──────────────────────────────────────────────────
  if (!packId || !userId) {
    return json({ error: 'packId and userId required' }, 400);
  }

  const PACKS = {
    starter: { name: '体验包 30积分', credits: 30, usd: '6.00' },
    value:   { name: '超值包 200积分', credits: 200, usd: '30.00' },
    bulk:    { name: '畅用包 1000积分', credits: 1000, usd: '100.00' },
  };

  const pack = PACKS[packId];
  if (!pack) {
    return json({ error: 'Invalid packId' }, 400);
  }

  const CLIENT_ID = env.PAYPAL_CLIENT_ID;
  const SECRET    = env.PAYPAL_SECRET;
  if (!CLIENT_ID || !SECRET) {
    return json({ error: 'PayPal not configured' }, 500);
  }

  // Verify user
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
    const creds    = btoa(`${CLIENT_ID}:${SECRET}`);
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type':  'application/x-www-form-urlencoded',
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
      description:  pack.name,
      amount: {
        currency_code: 'USD',
        value:         pack.usd,
      },
      custom_id: JSON.stringify({ packId, userId }),
    }],
    application_context: {
      brand_name:  'BG Remover',
      landing_page: 'NO_PREFERENCE',
      user_action:  'PAY_NOW',
      return_url:   `${new URL(request.url).origin}/pricing?payment=success`,
      cancel_url:   `${new URL(request.url).origin}/pricing?payment=cancelled`,
    },
  };

  try {
    const paypalRes = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
        'PayPal-Request-Id': `order_${Date.now()}_${userId}`,
      },
      body: JSON.stringify(paypalOrder),
    });
    const orderData = await paypalRes.json();

    if (!paypalRes.ok) {
      return json({ error: 'PayPal order creation failed', detail: orderData }, 502);
    }

    // Store order in D1
    const orderId = orderData.id;
    try {
      await env.DB.prepare(
        'INSERT INTO paypal_orders (order_id, user_id, pack_id, credits, amount_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(orderId, userId, packId, pack.credits, pack.usd, 'created', Date.now()).run();
    } catch (e) {
      console.error('Failed to store order:', e.message);
    }

    return json({ orderID: orderId, status: orderData.status });

  } catch (e) {
    return json({ error: 'PayPal request failed', detail: e.message }, 502);
  }
}
