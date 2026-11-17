import { createHmac, timingSafeEqual } from 'node:crypto';
import { accessToken, shopDomain } from './lib/shopify.mjs';
import { syncRules } from './lib/rules.mjs';

function verify(raw, signature) {
  if (!signature || !process.env.SHOPIFY_CLIENT_SECRET) return false;
  const expected = createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET).update(raw).digest();
  const received = Buffer.from(signature, 'base64');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export default async function handler(request) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (!verify(raw, request.headers.get('x-shopify-hmac-sha256'))) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.headers.get('x-shopify-shop-domain') !== shopDomain()) {
    return new Response('Wrong shop', { status: 403 });
  }
  const topic = request.headers.get('x-shopify-topic');
  if (!['profiles/create','profiles/update','profiles/delete'].includes(topic)) {
    return new Response('Ignored topic', { status: 200 });
  }
  try {
    const token = await accessToken();
    await syncRules(token);
    return new Response('Synced', { status: 200 });
  } catch (error) {
    console.error('Webhook sync failure:', error.message);
    // Shopify retries delivery on non-2xx responses.
    return new Response('Sync failed; retry', { status: 503 });
  }
}
