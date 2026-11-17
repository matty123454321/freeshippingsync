import { accessToken } from './lib/shopify.mjs';
import { syncRules } from './lib/rules.mjs';
import { ensureWebhooks } from './lib/webhooks.mjs';

const json = (data, status=200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  const key = process.env.SYNC_KEY;
  if (!key || request.headers.get('Authorization') !== `Bearer ${key}`) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    const token = await accessToken();
    const sync = await syncRules(token);
    const webhooks = await ensureWebhooks(token);
    return json({ ok: true, sync, webhooks });
  } catch (error) {
    console.error('Manual Shopify shipping sync failed:', error.message);
    return json({ ok: false, error: error.message }, 500);
  }
}
