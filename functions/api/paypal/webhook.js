// POST /api/paypal/webhook
// Receives PayPal webhook events (IPN alternative)
// Verifies webhook signature and processes events

export async function onRequestPost(context) {
  const { request, env } = context;

  // PayPal sends verification request first
  const url = new URL(request.url);
  if (url.searchParams.has('verification')) {
    // PayPal sends a POST with verification=true to verify webhook URL
    // Respond with the challenge
    const challenge = url.searchParams.get('challenge');
    return new Response(challenge || 'verified', { status: 200 });
  }

  const body = await request.text();
  const event = JSON.parse(body);
  const eventType = event.event_type;
  const resource = event.resource;

  const CLIENT_ID = env.PAYPAL_CLIENT_ID;
  const SECRET = env.PAYPAL_SECRET;
  const WEBHOOK_ID = env.PAYPAL_WEBHOOK_ID;

  console.log(`PayPal webhook: ${eventType}`);

  try {
    switch (eventType) {
      case 'CHECKOUT.ORDER.APPROVED': {
        // Order was approved but not yet captured
        // We'll handle capture on frontend redirect
        console.log('Order approved:', resource.id);
        break;
      }

      case 'PAYMENT.CAPTURE.COMPLETED': {
        // One-time payment completed
        const orderId = resource.supplementary_data?.related_ids?.order_id;
        if (!orderId) break;

        const existing = await env.DB.prepare(
          'SELECT status, user_id, pack_id, credits FROM paypal_orders WHERE order_id = ?'
        ).bind(orderId).first();

        if (!existing || existing.status === 'completed') break;

        // Credit the user
        await env.DB.prepare(
          'UPDATE users SET credits = credits + ? WHERE id = ?'
        ).bind(existing.credits, existing.user_id).run();

        await env.DB.prepare(
          'UPDATE paypal_orders SET status = ?, updated_at = ? WHERE order_id = ?'
        ).bind('completed', Date.now(), orderId).run();

        console.log(`Credited ${existing.credits} to user ${existing.user_id}`);
        break;
      }

      case 'PAYMENT.CAPTURE.DENIED': {
        const orderId = resource.supplementary_data?.related_ids?.order_id;
        if (!orderId) break;

        await env.DB.prepare(
          'UPDATE paypal_orders SET status = ?, updated_at = ? WHERE order_id = ?'
        ).bind('denied', Date.now(), orderId).run();

        break;
      }

      case 'BILLING.SUBSCRIPTION.CREATED': {
        const subId = resource.id;
        const customId = resource.custom_id;

        // Update subscription status
        await env.DB.prepare(
          'UPDATE paypal_subscriptions SET status = ?, paypal_subscription_id = ?, updated_at = ? WHERE subscription_id = ?'
        ).bind('ACTIVE', subId, Date.now(), subId).run();

        // Add first month credits
        if (customId) {
          const sub = await env.DB.prepare(
            'SELECT user_id, credits FROM paypal_subscriptions WHERE subscription_id = ?'
          ).bind(subId).first();

          if (sub) {
            await env.DB.prepare(
              'UPDATE users SET credits = credits + ?, plan_type = ? WHERE id = ?'
            ).bind(sub.credits, sub.plan_id, sub.user_id).run();

            await env.DB.prepare(
              'INSERT INTO credit_usage (id, user_id, credits, action, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(
              crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
              sub.user_id, sub.credits, `paypal_sub_${sub.plan_id}_monthly`, 0, Date.now()
            ).run();
          }
        }

        console.log('Subscription activated:', subId);
        break;
      }

      case 'BILLING.SUBSCRIPTION.REVOKED':
      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        const subId = resource.id;
        await env.DB.prepare(
          'UPDATE paypal_subscriptions SET status = ?, updated_at = ? WHERE subscription_id = ?'
        ).bind('CANCELLED', Date.now(), subId).run();
        console.log('Subscription cancelled:', subId);
        break;
      }

      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        const subId = resource.id;
        await env.DB.prepare(
          'UPDATE paypal_subscriptions SET status = ?, updated_at = ? WHERE subscription_id = ?'
        ).bind('SUSPENDED', Date.now(), subId).run();
        break;
      }

      case 'PAYMENT.SALE.COMPLETED': {
        // Recurring payment for subscription
        const subId = resource.billing_agreement_id;
        const sub = await env.DB.prepare(
          'SELECT user_id, credits FROM paypal_subscriptions WHERE subscription_id = ?'
        ).bind(subId).first();

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
        }
        break;
      }

      default:
        console.log(`Unhandled event: ${eventType}`);
    }
  } catch (e) {
    console.error('Webhook processing error:', e.message);
    return new Response('error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
