/**
 * Read the current merchant-owned shipping profiles, extracting ONLY simple
 * price-based, zero-cost shipping rules. Ambiguous / mismatched conditions are
 * deliberately omitted to avoid falsely promising free shipping at checkout.
 */
import { adminGraphQL } from './shopify.mjs';

const PROFILES = `query Profiles($after: String) {
  shop { id }
  deliveryProfiles(first: 5, after: $after, merchantOwnedOnly: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name default version
      profileLocationGroups {
        locationGroupZones(first: 10) {
          pageInfo { hasNextPage }
          nodes {
            zone { name countries { code { countryCode restOfWorld } provinces { code } } }
            methodDefinitions(first: 10) {
              pageInfo { hasNextPage }
              nodes {
                active name
                methodConditions {
                  field operator
                  conditionCriteria {
                    __typename
                    ... on MoneyV2 { amount currencyCode }
                  }
                }
                rateProvider {
                  __typename
                  ... on DeliveryRateDefinition { price { amount currencyCode } }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const PROFILE_ITEMS = `query ProfileItems($id: ID!, $after: String) {
  deliveryProfile(id: $id) {
    profileItems(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { product { handle } }
    }
  }
}`;

function shippingPrice(rate) {
  return rate.rateProvider?.__typename === 'DeliveryRateDefinition' ? rate.rateProvider.price : null;
}

export function extractFreeThreshold(method) {
  if (!method.active) return null;
  const price = shippingPrice(method);
  if (!price || Math.abs(Number(price.amount)) > 0.00001) return null;
  let minimum = 0;
  let maximum = Infinity;
  let currency = price.currencyCode;
  for (const condition of method.methodConditions || []) {
    if (condition.field !== 'TOTAL_PRICE' || condition.conditionCriteria?.__typename !== 'MoneyV2') return null;
    const c = condition.conditionCriteria;
    if (c.currencyCode !== currency) return null;
    const amount = Number(c.amount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (condition.operator === 'GREATER_THAN_OR_EQUAL_TO') minimum = Math.max(minimum, amount);
    else if (condition.operator === 'LESS_THAN_OR_EQUAL_TO') maximum = Math.min(maximum, amount);
    else return null;
  }
  // The current theme models an unlimited free-shipping minimum threshold.
  // Bounded free rates cannot safely be expressed as a single goal.
  if (maximum !== Infinity || minimum <= 0) return null;
  return { freeThreshold: minimum, currency };
}

function extractFlatRate(method) {
  if (!method.active || (method.methodConditions || []).length !== 0) return null;
  const price = shippingPrice(method);
  if (!price) return null;
  const amount = Number(price.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: price.currencyCode };
}

export function rulesFromZone(zoneEntry) {
  if (zoneEntry.methodDefinitions.pageInfo.hasNextPage) {
    throw new Error(`More shipping methods than the supported page size in zone ${zoneEntry.zone.name}`);
  }
  const methods = zoneEntry.methodDefinitions.nodes;
  const freeOptions = methods.map(extractFreeThreshold).filter(Boolean);
  if (!freeOptions.length) return null;
  const currencies = new Set(freeOptions.map(x => x.currency));
  if (currencies.size !== 1) return null;
  const currency = [...currencies][0];
  // Earliest threshold at which a free rate becomes available.
  const freeThreshold = Math.min(...freeOptions.map(x => x.freeThreshold));
  const standard = methods.map(extractFlatRate).filter(x => x && x.currency === currency);
  const standardShipping = standard.length ? Math.min(...standard.map(x => x.amount)) : null;
  return { currency, freeThreshold, ...(standardShipping == null ? {} : { standardShipping }) };
}

function sameRules(a, b) {
  return a.freeThreshold === b.freeThreshold && a.currency === b.currency && a.standardShipping === b.standardShipping;
}

async function allProfiles(token) {
  const profiles = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const data = await adminGraphQL(token, PROFILES, { after });
    if (!data?.shop?.id) throw new Error('Missing shop ID from Shopify');
    for (const profile of data.deliveryProfiles.nodes) profiles.push(profile);
    if (!data.deliveryProfiles.pageInfo.hasNextPage) {
      return { shopId: data.shop.id, profiles };
    }
    after = data.deliveryProfiles.pageInfo.endCursor;
  }
  throw new Error('Too many delivery profiles; refusing partial sync');
}

async function excludedProductHandles(token, profiles) {
  const excluded = new Set();
  for (const profile of profiles.filter(p => !p.default)) {
    let after = null;
    for (let page = 0; page < 200; page++) {
      const data = await adminGraphQL(token, PROFILE_ITEMS, { id: profile.id, after });
      const items = data?.deliveryProfile?.profileItems;
      if (!items) throw new Error(`Unable to retrieve excluded profile items: ${profile.name}`);
      for (const item of items.nodes) if (item.product?.handle) excluded.add(item.product.handle);
      if (!items.pageInfo.hasNextPage) break;
      if (page === 199) throw new Error('Too many non-default profile products; refusing partial sync');
      after = items.pageInfo.endCursor;
    }
  }
  return [...excluded].sort();
}

export async function buildShippingRules(token) {
  const { shopId, profiles } = await allProfiles(token);
  const main = profiles.find(p => p.default);
  if (!main) throw new Error('No general/default merchant delivery profile found');
  const markets = {};
  const conflicts = new Set();
  for (const group of main.profileLocationGroups) {
    if (group.locationGroupZones.pageInfo.hasNextPage) {
      throw new Error('More zones than supported; refusing incomplete sync');
    }
    for (const entry of group.locationGroupZones.nodes) {
      const rule = rulesFromZone(entry);
      if (!rule) continue;
      for (const country of entry.zone.countries) {
        // A country with subregional-only rates or rest-of-world grouping is not safe to advertise broadly.
        if (country.code.restOfWorld || !country.code.countryCode || country.provinces.length) continue;
        const code = country.code.countryCode;
        if (markets[code] && !sameRules(markets[code], rule)) conflicts.add(code);
        else markets[code] = rule;
      }
    }
  }
  for (const code of conflicts) delete markets[code];
  const handles = await excludedProductHandles(token, profiles);
  const result = {
    source: 'shopify_delivery_profiles',
    updatedAt: new Date().toISOString(),
    profiles: Object.fromEntries(profiles.map(p => [p.name, p.version])),
    markets,
    excludedProductHandles: handles,
  };
  return { shopId, result, conflicts: [...conflicts] };
}

const SET_RULES = `mutation SetShippingRules($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { namespace key updatedAt }
    userErrors { code field message }
  }
}`;

export async function syncRules(token) {
  const { shopId, result, conflicts } = await buildShippingRules(token);
  const saved = await adminGraphQL(token, SET_RULES, {
    metafields: [{
      ownerId: shopId,
      namespace: 'aries_shipping',
      key: 'rules',
      type: 'json',
      value: JSON.stringify(result),
    }],
  });
  const payload = saved?.metafieldsSet;
  if (payload?.userErrors?.length || !payload?.metafields?.length) {
    throw new Error(`Could not save shop shipping metafield: ${JSON.stringify(payload?.userErrors || [])}`);
  }
  return {
    updatedAt: result.updatedAt,
    markets: result.markets,
    excludedProductCount: result.excludedProductHandles.length,
    excludedCountryConflicts: conflicts,
  };
}
