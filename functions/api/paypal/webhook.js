// POST /api/paypal/webhook
// Receives PayPal webhook events

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.text();
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = event.event_type;
  const resource = event.resource || {};
  const clientId = event.client_metadata?.payer_id || '';

  console.log(`PayPal webhook: ${eventType} | resource_id: ${resource.id}`);

  const CLIENT_ID = env.PAYPAL_CLIENT_ID;
  const SECRET = env.PAYPAL_SECRET;

  try {
    // ─── PAYMENT.CAPTURE.COMPLETED (one-time payment captured) ───
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      // Try different field names for order ID
      const orderId = resource.supplementary_data?.related_ids?.order_id
        || resource.order_id
        || resource.id;

      if (!orderId) {
        console.log('PAYMENT.CAPTURE.COMPLETED: no order_id found');
        return new Response('OK', { status: 200 });
      }

      console.log(`Processing payment capture: ${orderId}`);

      // Find the order
      const existing = await env.DB.prepare(
        'SELECT status, user_id, pack_id, credits FROM paypal_orders WHERE order_id = ?'
      ).bind(orderId).first();

      if (!existing) {
        console.log(`Order ${orderId} not found in DB`);
        return new Response('OK', { status: 200 });
      }

      if (existing.status === 'completed') {
        console.log(`Order ${orderId} already processed`);
        return new Response('OK', { status: 200 });
      }

      // Add credits
      await env.DB.prepare(
        'UPDATE users SET credits = credits + ? WHERE id = ?'
      ).bind(existing.credits, existing.user_id).run();

      // Log usage
      await env.DB.prepare(
        'INSERT INTO credit_usage (id, user_id, credits, action, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        existing.user_id, existing.credits, `paypal_${existing.pack_id}`, 0, Date.now()
      ).run();

      // Update status
      await env.DB.prepare(
        'UPDATE paypal_orders SET status = ?, updated_at = ? WHERE order_id = ?'
      ).bind('completed', Date.now(), orderId).run();

      console.log(`Credited ${existing.credits} to user ${existing.user_id} for order ${orderId}`);
      return new Response('OK', { status: 200 });
    }

    // ─── CHECKOUT.ORDER.APPROVED ───
    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      const orderId = resource.id;
      if (!orderId) return new Response('OK', { status: 200 });

      const existing = await env.DB.prepare(
        'SELECT status FROM paypal_orders WHERE order_id = ?'
      ).bind(orderId).first();

      if (existing && existing.status === 'created') {
        await env.DB.prepare(
          'UPDATE paypal_orders SET status = ?, updated_at = ? WHERE order_id = ?'
        ).bind('approved', Date.now(), orderId).run();
        console.log(`Order ${orderId} approved`);
      }
      return new Response('OK', { status: 200 });
    }

    // ─── BILLING.SUBSCRIPTION.CREATED ───
    if (eventType === 'BILLING.SUBSCRIPTION.CREATED') {
      const subId = resource.id;
      const customId = resource.custom_id || '';

      await env.DB.prepare(
        'UPDATE paypal_subscriptions SET status = ?, paypal_subscription_id = ?, updated_at = ? WHERE subscription_id = ?'
      ).bind('ACTIVE', subId, Date.now(), subId).run();

      // Credit first month
      const sub = await env.DB.prepare(
        'SELECT user_id, credits, plan_id FROM paypal_subscriptions WHERE subscription_id = ?'
      ).bind(subId).first();

      if (sub) {
        await env.DB.prepare(
          'UPDATE users SET credits = credits + ?, plan_type = ? WHERE id = ?'
        ).bind(sub.credits, sub.plan_id, sub.user_id).run();

        await env.DB.prepare(
          'INSERT INTO credit_usage (id, user_id, credits, action, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
          crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
          sub.user_id, sub.credits, `paypal_sub_${sub.plan_id}`, 0, Date.now()
        ).run();
        console.log(`Subscription ${subId} activated, credited ${sub.credits} to ${sub.user_id}`);
      }
      return new Response('OK', { status: 200 });
    }

    // ─── BILLING.SUBSCRIPTION.REVOKED / CANCELLED ───
    if (eventType === 'BILLING.SUBSCRIPTION.CANCELED' || eventType === 'BILLING.SUBSCRIPTION.REVOKED') {
      const subId = resource.id;
      await env.DB.prepare(
        'UPDATE paypal_subscriptions SET status = ?, updated_at = ? WHERE subscription_id = ?'
      ).bind('CANCELLED', Date.now(), subId).run();
      console.log(`Subscription ${subId} cancelled`);
      return new Response('OK', { status: 200 });
    }

    // ─── PAYMENT.SALE.COMPLETED (subscription renewal) ───
    if (eventType === 'PAYMENT.SALE.COMPLETED') {
      const billingAgreementId = resource.billing_agreement_id;
      const sub = await env.DB.prepare(
        'SELECT user_id, credits FROM paypal_subscriptions WHERE subscription_id = ?'
      ).bind(billingAgreementId).first();

      if (sub) {
        await env.DB.prepare(
          'UPDATE users SET credits = credits + ? WHERE id = ?'
        ).bind(sub.credits, sub.user_id).run();

        await env.DB.prepare(
          'INSERT INTO credit_usage (id, user_id, credits, action, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
          crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
          sub.user_id, sub.credits, `paypal_sub_renewal`, 0, Date.now()
        ).run();
        console.log(`Renewal: credited ${sub.credits} to ${sub.user_id}`);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('OK', { status: 200 });

  } catch (e) {
    console.error(`Webhook error (${eventType}): ${e.message}`);
    return new Response('Error', { status: 500 });
  }
}
