// POST /api/paypal/create-subscription
// Body: { planId: 'basic'|'pro'|'team', userId: string }
// Returns: { approvalURL: string }

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

  // Monthly plan definitions (USD amounts)
  const PLANS = {
    basic: { name: 'BG Remover Basic', credits: 60, usd: '1.35', planId: 'BGREMOVER_BASIC' },
    pro:   { name: 'BG Remover Pro', credits: 200, usd: '3.95', planId: 'BGREMOVER_PRO' },
    team:  { name: 'BG Remover Team', credits: 800, usd: '13.50', planId: 'BGREMOVER_TEAM' },
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

  // Create subscription with PayPal
  // Note: plan must exist in PayPal sandbox OR we use inline plan creation
  const subBody = {
    intent: 'SUBSCRIBE',
    subscriber: {
      email_address: user.email,
      name: {
        given_name: (user.name || user.email || 'User').split(' ')[0],
        surname: (user.name || '').split(' ').slice(1).join(' ') || 'User',
      },
    },
    plan: {
      plan_id: plan.planId,
    },
    application_context: {
      brand_name: 'BG Remover',
      landing_page: 'NO_PREFERENCE',
      user_action: 'SUBSCRIBE_NOW',
      return_url: `${new URL(request.url).origin}/profile`,
      cancel_url: `${new URL(request.url).origin}/pricing`,
    },
  };

  let subRes;
  try {
    subRes = await fetch('https://api-m.sandbox.paypal.com/v1/billing/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `sub_${Date.now()}_${userId}`,
      },
      body: JSON.stringify(subBody),
    });
    const subData = await subRes.json();

    if (!subRes.ok) {
      console.error('PayPal subscription error:', JSON.stringify(subData));
      return json({ error: 'Subscription creation failed', detail: subData }, 502);
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
    if (!approvalLink) {
      return json({ error: 'No approval URL returned', detail: subData }, 502);
    }

    return json({
      subscriptionID: subData.id,
      status: subData.status,
      approvalURL: approvalLink.href,
    });

  } catch (e) {
    console.error('Subscription request exception:', e.message);
    return json({ error: 'Subscription request failed', detail: e.message }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
