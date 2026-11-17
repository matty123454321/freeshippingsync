# Aries Shipping Sync — Netlify app

This is a Shopify Admin API connector for the **Aries** store. It is **not** an embedded Shopify admin interface. The app can be installed and still show a blank/default page when clicked inside Shopify; that is normal.

## What it does

- Reads your **current Shopify shipping rates**, including the free-shipping price condition.
- Writes a shared **shop JSON metafield** (`aries_shipping.rules`) already consumed by the unpublished **Aries Black Friday V5** theme.
- Subscribes to `profiles/create`, `profiles/update`, and `profiles/delete` webhooks to sync after changes.
- Rechecks every six hours to recover from missed webhooks.
- Includes a protected one-click **Sync shipping settings now** page.
- Excludes products in non-General shipping profiles from free-shipping promises, rather than incorrectly suggesting that the General rate applies to them.
- Hides unmodelled regions rather than making false free-shipping promises.

**Important:** This app never edits the checkout rate itself. It reads Shopify Shipping and delivery as the source of truth.

## 1. In Shopify

1. Check the app is installed on the **Aries** store (you already saw **1 install**).
2. Check the currently released version has **`read_shipping`**. **Also add `read_products`** in a new app version, release it and approve the updated permissions. That extra *read-only* scope is needed to identify products in different shipping profiles (like Gnarly), so the theme cannot falsely advertise free shipping on them.
3. In **Settings → Credentials**, locate the **Client ID** and **Client secret**. Do not send either in chat or upload `.env` to GitHub.
4. If a later API response returns a permission error when writing shop metafields, inspect the permissions suggested by Shopify's error and release/reapprove the necessary permissions. `read_shipping` grants shipping *read* access; exact metafield write permissions depend on resource/definition access. Don't add `write_shipping`—the app does not change checkout rates.

## 2. Deploy to a *new* Netlify site

**Use a separate Netlify site from the Zodiac storefront.**

Easiest deployment: create a private GitHub repository, upload all files in this folder **except `.env`**, then in Netlify select **Add new project → Import an existing project → GitHub** and pick the repository. Netlify detects `netlify.toml` and publishes the UI plus the Functions. Drag-and-drop publishing generally does not build source functions; use Git or the Netlify CLI.

Alternatively, from a Mac terminal with Node installed, run:

```
npm install
npx netlify-cli login
npx netlify-cli init
npx netlify-cli deploy --build --prod
```

## 3. Add environment variables to the new Netlify site

Open the Netlify project → **Project configuration → Environment variables**. Configure for **Functions** (or all relevant scopes):

| Key | Value |
| --- | --- |
| `SHOPIFY_SHOP` | `ariesarise.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Your Shopify app Client ID |
| `SHOPIFY_CLIENT_SECRET` | Your Shopify app Client secret |
| `PUBLIC_BASE_URL` | Your new Netlify project's public HTTPS URL, without a final `/` |
| `SYNC_KEY` | A long random password, **different from the Shopify secret** |

Use the published `.netlify.app` URL for `PUBLIC_BASE_URL` until you intentionally configure a custom domain. Do **not** include any credentials in the code or repository. After adding variables, **trigger a fresh production deploy** so the Functions can read them.

## 4. Run the initial sync

Open your new Netlify site's URL (its homepage). Enter only the `SYNC_KEY` you chose in Netlify and click **Sync shipping settings now**.

Success response includes:

- `ok: true`
- `sync.markets.GB.freeThreshold: 1000` if UK Shipping and delivery is still at £1,000
- `sync.markets.GB.standardShipping: 7.5` if standard UK shipping is still £7.50
- Three webhook registrations (or `already registered`).

If you receive `shop_not_permitted`, the app and store aren't in the same Shopify organization for client-credentials auth. That flow cannot be used in that setup; instead, the app needs an installation OAuth flow. If you receive `ACCESS_DENIED` for a metafield write, review the metafield's access and your app scopes.

## 5. Test safely

1. Preview unpublished Aries V5 and check the UK £1,000 progress target.
2. Temporarily set UK free shipping in Shopify **Shipping and delivery** to £800.
3. Wait for webhook delivery or click **Sync shipping settings now** to verify the new rate.
4. Verify the bar and PLP/PDP free-shipping tags at the new threshold, on both mobile and desktop.
5. Restore the intended checkout rate, and repeat verification.

This does not publish Aries V5. The current live Aries theme remains untouched.

## Security and correctness notes

- All Shopify credentials remain in Netlify Functions. The homepage uses only the separate `SYNC_KEY` to authorize a manual sync.
- Webhook deliveries are verified against the Shopify HMAC signature on the **raw** request body, and the store domain is checked.
- Shopify webhook subscriptions are registered through the **Aries Shipping Sync app's own access token**, not through another app.
- Multiple shipping rates, shipping discounts, product-specific overrides, remote carrier-calculated fees, province-specific rates, rest-of-world rules, or special checkout conditions may need additional logic. This starter intentionally *does not promise* free shipping where it cannot confidently interpret a Shopify free rate.
- Products in another shipping profile are excluded from the free-shipping tag. It doesn't currently display a separate threshold for an alternative profile.
- Currently only the UK General profile has a simple free price-conditioned rate (the profile inspected on 17 November 2026); no other free rate is inferred.
- Netlify logs may show API errors but do not deliberately log access tokens or client secrets.

## Files

- `netlify/functions/sync-now.mjs` — private manual sync + webhook setup
- `netlify/functions/shopify-webhook.mjs` — Shopify change notifications
- `netlify/functions/sync-scheduled.mjs` — safety re-sync every six hours
- `netlify/functions/lib/*.mjs` — API calls and shipping parsing
- `public/index.html` — simple private manual sync UI
- `tests/rules.test.mjs` — basic unit tests (`npm test`)

## Shopify reference

- [Client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
- [Webhook topics](https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic)
- [Verify webhooks](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)
- [Metafields set](https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet)
