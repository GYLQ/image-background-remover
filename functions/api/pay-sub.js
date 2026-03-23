// POST /api/pay-sub
// Body: { subscriptionPlanId: 'basic'|'pro'|'team', userId: string }
// Returns: { subscriptionID: string, status: string, approvalURL: string }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost(context) {
  // Subscription feature is disabled per user request
  return json({ error: 'disabled' }, 403);
}

export async function onRequestPost_DISABLED(context) {
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

  const { subscriptionPlanId, userId } = body;

  if (!subscriptionPlanId) {
    return json({ error: 'subscriptionPlanId required' }, 400);
  }
  if (!userId) {
    return json({ error: 'userId required' }, 400);
  }

  const PLANS = {
    basic: { name: 'BG Remover Basic', credits: 60, usd: '1.35' },
    pro:   { name: 'BG Remover Pro',   credits: 200, usd: '3.95' },
    team:  { name: 'BG Remover Team', credits: 800, usd: '13.50' },
  };

  const plan = PLANS[subscriptionPlanId];
  if (!plan) {
    return json({ error: 'Invalid subscriptionPlanId' }, 400);
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
