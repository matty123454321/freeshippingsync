import { accessToken } from './lib/shopify.mjs';
import { syncRules } from './lib/rules.mjs';
import { ensureWebhooks } from './lib/webhooks.mjs';

export default async function handler() {
  try {
    const token = await accessToken();
    const result = await syncRules(token);
    await ensureWebhooks(token);
    console.log(`Scheduled Shopify shipping rules sync complete (${Object.keys(result.markets).length} markets).`);
  } catch (error) {
    console.error('Scheduled Shopify shipping sync failed:', error.message);
    throw error;
  }
}

export const config = { schedule: '0 */6 * * *' };
