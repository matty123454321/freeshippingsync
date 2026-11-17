import { adminGraphQL } from './shopify.mjs';

const SUBS = `query { webhookSubscriptions(first: 50) { nodes { id topic uri } pageInfo { hasNextPage } } }`;
const CREATE = `mutation CreateHook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;

export async function ensureWebhooks(token) {
  const site = process.env.PUBLIC_BASE_URL;
  if (!site || !/^https:\/\/[^/]+$/.test(site)) {
    throw new Error('PUBLIC_BASE_URL must be https://your-site.netlify.app with no trailing slash');
  }
  const uri = `${site}/.netlify/functions/shopify-webhook`;
  const existing = await adminGraphQL(token, SUBS);
  if (existing.webhookSubscriptions.pageInfo.hasNextPage) {
    throw new Error('More than 50 webhook subscriptions; manual review required');
  }
  const wanted = ['PROFILES_CREATE', 'PROFILES_UPDATE', 'PROFILES_DELETE'];
  const installed = [];
  for (const topic of wanted) {
    if (existing.webhookSubscriptions.nodes.some(h => h.topic === topic && h.uri === uri)) {
      installed.push({ topic, status: 'already registered' });
      continue;
    }
    const result = await adminGraphQL(token, CREATE, { topic, webhookSubscription: { uri } });
    const payload = result?.webhookSubscriptionCreate;
    if (payload?.userErrors?.length || !payload?.webhookSubscription?.id) {
      throw new Error(`Could not register ${topic}: ${JSON.stringify(payload?.userErrors || [])}`);
    }
    installed.push({ topic, status: 'registered' });
  }
  return installed;
}
