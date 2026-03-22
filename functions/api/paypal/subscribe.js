// POST /api/paypal/create-subscription
// Body: { planId: 'basic'|'pro'|'team', userId: string }
// Returns: { subscriptionID: string }

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

  const { planId, userId } = body;
  if (!planId || !userId) {
    return json({ error: 'planId and userId required' }, 400);
  }

  // Monthly plan definitions (amount in USD)
  const PLANS = {
    basic: { name: '基础版', credits: 60, usd: '9.90' },
    pro:   { name: '专业版', credits: 200, usd: '29.00' },
    team:  { name: '团队版', credits: 800, usd: '99.00' },
  };

  const plan = PLANS[planId];
  if (!plan) {
    return json({ error: 'Invalid planId' }, 400);
  }

  const CLIENT_ID = env.PAYPAL_CLIENT_ID;
  const SECRET = env.PAYPAL_SECRET;
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
    if (!tokenRes.ok) {
      return json({ error: 'PayPal auth failed', detail: tokenData }, 502);
    }
    accessToken = tokenData.access_token;
  } catch (e) {
    return json({ error: 'PayPal network error', detail: e.message }, 502);
  }

  // Create PayPal subscription
  const subscription = {
    intent: 'BILLING_AGREEMENT',
    subscriber: {
      name: {
        given_name: user.name?.split(' ')[0] || user.email.split('@')[0],
        surname: user.name?.split(' ').slice(1).join(' ') || '',
      },
      email_address: user.email,
    },
    plan: {
      plan_id: `BGREMOVER_${planId.toUpperCase()}`,
    },
    application_context: {
      brand_name: 'BG Remover',
      landing_page: 'NO_PREFERENCE',
      user_action: 'SUBSCRIBE_NOW',
      return_url: `${new URL(request.url).origin}/profile?subscription=success`,
      cancel_url: `${new URL(request.url).origin}/pricing?subscription=cancelled`,
    },
  };

  let subRes;
  try {
    subRes = await fetch('https://api-m.paypal.com/v1/billing/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `sub_${Date.now()}_${userId}`,
      },
      body: JSON.stringify(subscription),
    });
    const subData = await subRes.json();

    if (!subRes.ok) {
      return json({ error: 'PayPal subscription creation failed', detail: subData }, 502);
    }

    // Store subscription in D1
    try {
      await env.DB.prepare(
        'INSERT INTO paypal_subscriptions (subscription_id, user_id, plan_id, credits, amount_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(subData.id, userId, planId, plan.credits, plan.usd, 'PENDING', Date.now()).run();
    } catch (e) {
      console.error('Failed to store subscription:', e.message);
    }

    // Find approval URL
    const approvalLink = subData.links?.find(l => l.rel === 'approve');
    return json({
      subscriptionID: subData.id,
      status: subData.status,
      approvalURL: approvalLink?.href,
    });

  } catch (e) {
    return json({ error: 'Subscription request failed', detail: e.message }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
