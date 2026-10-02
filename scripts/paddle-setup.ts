/**
 * Creates (or checks) the Rolestash catalog and webhook in a Paddle account,
 * idempotently: products, the six prices (monthly, quarterly, yearly × Pro,
 * Advanced) with local prices, and the notification destination for
 * paddle-webhook. Run it for the sandbox or, at go-live, for production.
 *
 *   set -a; . ./secrets.env; set +a
 *   npx tsx scripts/paddle-setup.ts sandbox            # dry run: what would change
 *   npx tsx scripts/paddle-setup.ts production --apply # make the changes
 *
 * Keys come from the environment: PADDLE_API_KEY (sandbox) or
 * PADDLE_LIVE_API_KEY (production). A newly created webhook's secret is
 * appended to secrets.env (never printed). Price IDs are public and printed.
 */
import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Env = 'sandbox' | 'production';
type Tier = 'pro' | 'advanced';
type Interval = 'month' | 'quarter' | 'year';

const ROOT = resolve(import.meta.dirname, '..');
const WEBHOOK = 'https://fhclnxqumcdsqxyunelp.supabase.co/functions/v1/paddle-webhook';
const EVENTS = [
  'subscription.activated',
  'subscription.canceled',
  'subscription.created',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
  'subscription.trialing',
  'subscription.updated',
];

const PRODUCTS: Record<Tier, { name: string; description: string }> = {
  pro: {
    name: 'Rolestash Pro',
    description:
      '60 active jobs, full autofill, Insights, contacts and documents, reminders and sync across 3 computers.',
  },
  advanced: {
    name: 'Rolestash Advanced',
    description:
      'Unlimited active jobs, automatic status updates from your job emails, and sync across 5 devices including your phone.',
  },
};

/** Minor units: USD (tax added) and tax-inclusive GBP (GB), EUR (IE), AUD (AU). ADR-0013. */
const PRICES: Record<
  Tier,
  Record<Interval, [usd: number, gbp: number, eur: number, aud: number]>
> = {
  pro: {
    month: [700, 550, 650, 1000],
    quarter: [1800, 1400, 1650, 2600],
    year: [5900, 4800, 5500, 8900],
  },
  advanced: {
    month: [1500, 1199, 1399, 2299],
    quarter: [3900, 3100, 3600, 5900],
    year: [15900, 12900, 14500, 23900],
  },
};
/**
 * Regional (purchasing-power) prices: round local amounts chosen by hand for
 * lower-income markets, not conversions of the US price (ADR-0013, 2026-10-02).
 * Minor units, by tier: [pro month, pro quarter, pro year, adv month, adv quarter, adv year].
 * Volatile currencies (ARS, TRY) are priced in USD. Sanctioned countries,
 * where Paddle doesn't sell, are left out.
 */
const REGIONAL: { countries: string[]; currency: string; amounts: number[] }[] = [
  // Low and lower-middle income, in local currency.
  { countries: ['IN'], currency: 'INR', amounts: [24900, 64900, 219900, 54900, 139900, 499900] },
  { countries: ['VN'], currency: 'VND', amounts: [69000, 179000, 599000, 149000, 389000, 1299000] },
  // Low and lower-middle income, in USD.
  {
    countries: [
      'PK',
      'BD',
      'NP',
      'LK',
      'NG',
      'KE',
      'GH',
      'EG',
      'ET',
      'UG',
      'TZ',
      'RW',
      'ZM',
      'SN',
      'CI',
      'CM',
      'PH',
      'ID',
      'KH',
      'LA',
      'MN',
      'BO',
      'HN',
      'MA',
      'TN',
      'DZ',
      'UZ',
      'KG',
      'TJ',
      'UA',
      'BJ',
      'BF',
      'MG',
      'MW',
      'MZ',
      'NE',
      'TG',
      'GN',
      'HT',
    ],
    currency: 'USD',
    amounts: [300, 800, 2500, 600, 1600, 5900],
  },
  // Upper-middle income, in local currency.
  { countries: ['BR'], currency: 'BRL', amounts: [1990, 4990, 16900, 3990, 9990, 34900] },
  { countries: ['MX'], currency: 'MXN', amounts: [7900, 19900, 69900, 16900, 44900, 149900] },
  {
    countries: ['CO'],
    currency: 'COP',
    amounts: [1490000, 3990000, 12990000, 3290000, 8490000, 28990000],
  },
  { countries: ['ZA'], currency: 'ZAR', amounts: [7900, 19900, 69900, 16900, 43900, 149900] },
  { countries: ['TH'], currency: 'THB', amounts: [14900, 37900, 129000, 29900, 79000, 269000] },
  { countries: ['CN'], currency: 'CNY', amounts: [2900, 7500, 24900, 5900, 15900, 54900] },
  // Upper-middle income, in USD.
  {
    countries: [
      'AR',
      'TR',
      'MY',
      'PE',
      'EC',
      'DO',
      'GT',
      'PY',
      'JM',
      'RS',
      'BA',
      'MK',
      'AL',
      'GE',
      'AM',
      'AZ',
      'KZ',
      'MD',
      'SV',
      'CR',
      'BW',
      'NA',
      'MU',
      'JO',
      'FJ',
    ],
    currency: 'USD',
    amounts: [450, 1200, 3900, 950, 2500, 9900],
  },
];

interface Override {
  country_codes: string[];
  unit_price: { amount: string; currency_code: string };
}

/** Every local price for one plan and interval: UK, Ireland, Australia, then the regions. */
function overridesFor(tier: Tier, interval: Interval): Override[] {
  const [, gbp, eur, aud] = PRICES[tier][interval];
  const slot = (tier === 'pro' ? 0 : 3) + ['month', 'quarter', 'year'].indexOf(interval);
  return [
    { country_codes: ['GB'], unit_price: { amount: String(gbp), currency_code: 'GBP' } },
    { country_codes: ['IE'], unit_price: { amount: String(eur), currency_code: 'EUR' } },
    { country_codes: ['AU'], unit_price: { amount: String(aud), currency_code: 'AUD' } },
    ...REGIONAL.map((r) => ({
      country_codes: r.countries,
      unit_price: { amount: String(r.amounts[slot]), currency_code: r.currency },
    })),
  ];
}

const sameOverrides = (a: Override[], b: Override[]) => {
  const key = (list: Override[]) =>
    JSON.stringify(
      list
        .map((o) => [
          [...o.country_codes].sort().join(','),
          o.unit_price.currency_code,
          String(Number(o.unit_price.amount)),
        ])
        .sort(),
    );
  return key(a) === key(b);
};

const CYCLE: Record<Interval, { interval: 'month' | 'year'; frequency: number }> = {
  month: { interval: 'month', frequency: 1 },
  quarter: { interval: 'month', frequency: 3 },
  year: { interval: 'year', frequency: 1 },
};
const LABEL: Record<Interval, string> = { month: 'monthly', quarter: 'quarterly', year: 'yearly' };

const arg = process.argv[2];
const apply = process.argv.includes('--apply');
if (arg !== 'sandbox' && arg !== 'production') {
  console.error('Usage: paddle-setup.ts <sandbox|production> [--apply]');
  process.exit(2);
}
const env: Env = arg;
const key = env === 'sandbox' ? process.env.PADDLE_API_KEY : process.env.PADDLE_LIVE_API_KEY;
if (!key) {
  console.error(
    `Missing ${env === 'sandbox' ? 'PADDLE_API_KEY' : 'PADDLE_LIVE_API_KEY'} in the environment.`,
  );
  process.exit(2);
}
const base = env === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key ?? ''}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path} → ${String(response.status)} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { data: T }).data;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  custom_data: { app?: string; tier?: string } | null;
}
interface Price {
  id: string;
  billing_cycle: { interval: string; frequency: number } | null;
  unit_price: { amount: string; currency_code: string };
  unit_price_overrides: Override[];
  custom_data: { tier?: string; interval?: string } | null;
}

const changes: string[] = [];
const ids: Record<Tier, Partial<Record<Interval, string>>> = { pro: {}, advanced: {} };

const products = await call<Product[]>('GET', '/products?status=active&per_page=200');
for (const tier of ['pro', 'advanced'] as const) {
  const want = PRODUCTS[tier];
  let product = products.find(
    (p) => p.custom_data?.app === 'rolestash' && p.custom_data.tier === tier,
  );
  if (!product) {
    changes.push(`create product ${want.name}`);
    if (apply)
      product = await call<Product>('POST', '/products', {
        name: want.name,
        description: want.description,
        tax_category: 'saas',
        custom_data: { app: 'rolestash', tier },
      });
  } else if (product.description !== want.description || product.name !== want.name) {
    changes.push(`update ${want.name} name/description`);
    if (apply)
      await call('PATCH', `/products/${product.id}`, {
        name: want.name,
        description: want.description,
      });
  }
  if (!product) continue;

  const prices = await call<Price[]>(
    'GET',
    `/prices?product_id=${product.id}&status=active&per_page=200`,
  );
  for (const interval of ['month', 'quarter', 'year'] as const) {
    const [usd] = PRICES[tier][interval];
    const cycle = CYCLE[interval];
    const found = prices.find(
      (p) =>
        p.billing_cycle?.interval === cycle.interval &&
        p.billing_cycle.frequency === cycle.frequency &&
        p.unit_price.currency_code === 'USD' &&
        Number(p.unit_price.amount) === usd,
    );
    if (found) {
      ids[tier][interval] = found.id;
      if (!sameOverrides(found.unit_price_overrides, overridesFor(tier, interval))) {
        changes.push(`update local prices on ${tier} ${LABEL[interval]}`);
        if (apply)
          await call('PATCH', `/prices/${found.id}`, {
            unit_price_overrides: overridesFor(tier, interval),
          });
      }
      continue;
    }
    const name = `${tier === 'pro' ? 'Pro' : 'Advanced'} ${LABEL[interval]}`;
    changes.push(`create price ${name}: US$${String(usd / 100)}`);
    if (!apply) continue;
    const created = await call<Price>('POST', '/prices', {
      product_id: product.id,
      name,
      description: name,
      billing_cycle: cycle,
      tax_mode: 'location',
      unit_price: { amount: String(usd), currency_code: 'USD' },
      unit_price_overrides: overridesFor(tier, interval),
      quantity: { minimum: 1, maximum: 1 },
      custom_data: { tier, interval },
    });
    ids[tier][interval] = created.id;
  }
}

interface Destination {
  id: string;
  destination: string;
  active: boolean;
  endpoint_secret_key?: string;
  subscribed_events: { name: string }[];
}
const destinations = await call<Destination[]>('GET', '/notification-settings');
const hook = destinations.find((d) => d.destination === WEBHOOK && d.active);
if (!hook) {
  changes.push(`create webhook → ${WEBHOOK}`);
  if (apply) {
    const created = await call<Destination>('POST', '/notification-settings', {
      description: 'Rolestash billing webhook',
      type: 'url',
      destination: WEBHOOK,
      subscribed_events: EVENTS,
      api_version: 1,
      traffic_source: 'all',
    });
    const name = env === 'sandbox' ? 'PADDLE_WEBHOOK_SECRET' : 'PADDLE_LIVE_WEBHOOK_SECRET';
    appendFileSync(join(ROOT, 'secrets.env'), `\n${name}=${created.endpoint_secret_key ?? ''}\n`);
    console.log(`Webhook created; its secret was appended to secrets.env as ${name}.`);
  }
} else {
  const missing = EVENTS.filter((e) => !hook.subscribed_events.some((s) => s.name === e));
  if (missing.length) changes.push(`webhook is missing events: ${missing.join(', ')}`);
}

console.log(
  `Paddle ${env}: ${changes.length ? `${apply ? 'applied' : 'would apply'}:` : 'everything is in place.'}`,
);
for (const change of changes) console.log(`  - ${change}`);
console.log(JSON.stringify({ prices: ids }, null, 2));
