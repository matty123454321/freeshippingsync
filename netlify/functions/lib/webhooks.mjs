
import { accessToken, shopDomain } from './shopify.mjs';
import { syncRules } from './rules.mjs';


/**
 * Shopify signs the *raw* body with the app's client secret. During secret
 * rotation, Shopify can continue to use the oldest unrevoked secret. The
 * optional SHOPIFY_WEBHOOK_SECRET lets that signing secret be verified without
 * changing SHOPIFY_CLIENT_SECRET (used by the OAuth client credentials flow).
 */
function signatureMatches(rawBody, base64Signature, secret) {
  if (!secret || !base64Signature) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Signature)) return false;
  const received = Buffer.from(base64Signature, 'base64');
  if (received.length !== 32) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(received, expected);
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Capture the body byte-for-byte before parsing it; reserializing JSON breaks
  // the Shopify HMAC check.
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get('x-shopify-hmac-sha256');
  const standardSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const rotatingSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const valid = signatureMatches(rawBody, signature, standardSecret) ||
    signatureMatches(rawBody, signature, rotatingSecret);

  if (!valid) {
    // Diagnostics deliberately contain NO credentials, payloads, or hashes.
    console.error('Shopify webhook rejected: HMAC verification failed', {
      topic: request.headers.get('x-shopify-topic'),
      shop: request.headers.get('x-shopify-shop-domain'),
      webhookId: request.headers.get('x-shopify-webhook-id'),
      signatureHeaderPresent: Boolean(signature),
      rawBodyBytes: rawBody.byteLength,
      clientSecretConfigured: Boolean(standardSecret),
      additionalWebhookSecretConfigured: Boolean(rotatingSecret),
    });
    return new Response('Invalid Shopify webhook signature', { status: 401 });
  }

  if (request.headers.get('x-shopify-shop-domain') !== shopDomain()) {
    console.error('Shopify webhook rejected: unexpected shop domain');
    return new Response('Wrong shop', { status: 403 });
  }

  const topic = request.headers.get('x-shopify-topic');
  if (!['profiles/create', 'profiles/update', 'profiles/delete'].includes(topic)) {
    return new Response('Ignored topic', { status: 200 });
  }

  try {
    const token = await accessToken();
    const result = await syncRules(token);
    console.info('Shopify shipping profile webhook synced', {
      topic,
      webhookId: request.headers.get('x-shopify-webhook-id'),
      updatedAt: result?.updatedAt,
      markets: Object.keys(result?.markets || {}),
    });
    return new Response('Synced', { status: 200 });
  } catch (error) {
    console.error('Shopify webhook sync failure:', error.message);
    // Shopify retries non-2xx deliveries.
    return new Response('Sync failed; retry', { status: 503 });
  }
}
