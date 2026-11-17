/** Shopify Admin API integration. Never expose these credentials to the browser. */
export const API_VERSION = '2026-10';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Netlify environment variable: ${name}`);
  return value;
}

export function shopDomain() {
  const shop = required('SHOPIFY_SHOP');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error('SHOPIFY_SHOP must be an exact *.myshopify.com domain');
  }
  return shop;
}

export async function accessToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: required('SHOPIFY_CLIENT_ID'),
    client_secret: required('SHOPIFY_CLIENT_SECRET'),
  });
  const response = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    const code = json.error || response.status;
    throw new Error(`Could not authenticate with Shopify (${code}). Check installation, credentials and organization ownership.`);
  }
  return json.access_token;
}

export async function adminGraphQL(token, query, variables = {}) {
  const response = await fetch(`https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors || [response.status])}`);
  }
  return json.data;
}
