/**
 * Creates (or checks) the Rolestash catalog and webhook in a Paddle account,
 * idempotently: the Pro product, its three prices (monthly, quarterly,
 * yearly) with local prices, and the notification destination for
 * paddle-webhook. One paid plan since ADR-0029; the Advanced product and the
 * older Pro prices stay in Paddle for the subscribers who still pay them. Run it for the sandbox or, at go-live, for production.
 *
 *   set -a; . ./secrets.env; set +a
 *   npx tsx scripts/paddle-setup.ts sandbox            # dry run: what would change
 *   npx tsx scripts/paddle-setup.ts production --apply # make the changes
 *   npx tsx scripts/paddle-setup.ts production --check # every country's checkout total
 *
 * Keys come from the environment: PADDLE_API_KEY (sandbox) or
 * PADDLE_LIVE_API_KEY (production). A newly created webhook's secret is
 * appended to secrets.env (never printed). Price IDs are public and printed.
 */
import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Env = 'sandbox' | 'production';
type Tier = 'pro';
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
  // Full refunds and chargebacks end the plan (refund policy; paddle-webhook).
  'adjustment.created',
  'adjustment.updated',
];

const PRODUCTS: Record<Tier, { name: string; description: string }> = {
  pro: {
    name: 'Rolestash Pro',
    description:
      'Unlimited active jobs, status updates from your job emails, full autofill, Insights, contacts and documents, reminders, and sync across 5 devices including your phone.',
  },
};

/**
 * Minor units: USD, and the tax-inclusive GBP (UK), EUR (eurozone) and AUD
 * (Australia) prices. ADR-0013; US$12 a month since ADR-0029, and every local
 * price below is scaled from it.
 */
const PRICES: Record<
  Tier,
  Record<Interval, [usd: number, gbp: number, eur: number, aud: number]>
> = {
  pro: {
    month: [1200, 999, 1099, 1799],
    quarter: [3000, 2400, 2700, 4400],
    year: [9900, 7900, 8900, 14900],
  },
};
/** The eurozone: one tax-inclusive euro price everywhere (Ireland's). */
const EUROZONE = [
  'AT',
  'BE',
  'HR',
  'CY',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PT',
  'SK',
  'SI',
  'ES',
];

/**
 * Round prices for other markets whose currency is enabled in Paddle, instead
 * of Paddle's unrounded conversion. Same slot order as REGIONAL. Tax-inclusive,
 * except Canada, where tax depends on the province and is added at checkout
 * (shown as "$16.99 CAD").
 */
const ROUND: { countries: string[]; currency: string; amounts: number[] }[] = [
  { countries: ['CA'], currency: 'CAD', amounts: [1699, 4199, 12900] },
  { countries: ['NZ'], currency: 'NZD', amounts: [1999, 4900, 15900] },
  { countries: ['CH'], currency: 'CHF', amounts: [1190, 2990, 9900] },
  { countries: ['SE'], currency: 'SEK', amounts: [13900, 32900, 109900] },
  // JPY has no minor unit.
  { countries: ['JP'], currency: 'JPY', amounts: [1900, 4600, 15000] },
];

/**
 * Countries where Paddle adds tax on top of these prices (rates as Paddle
 * charged them, checked 2026-10-03 with scripts/paddle-setup.ts --check).
 * Their prices are set before tax, so the checkout total is the round price.
 */
const TAX_ON_TOP: Record<string, number> = { VN: 0.25, ID: 0.11, KH: 0.1, LA: 0.1, TH: 0.07 };

/** Paddle rounds tax half to even (checked: 54.5 → 54). */
const roundTax = (x: number) => {
  const floor = Math.floor(x);
  if (Math.abs(x - floor - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
};

/**
 * The pre-tax amount whose checkout total is the round price, and that total.
 * When no whole-unit amount lands exactly (US$6.00 at 10–11%), it aims one
 * unit lower (US$5.99) instead.
 */
function beforeTax(total: number, rate: number): { net: number; total: number } {
  for (const target of [total, total - 1])
    for (let net = Math.floor(target / (1 + rate)) - 2; net <= target; net++)
      if (net + roundTax(net * rate) === target) return { net, total: target };
  return { net: Math.round(total / (1 + rate)), total };
}

/** What a buyer in this country pays at checkout for a round `amount`. */
const expectedTotal = (country: string, amount: number) =>
  country in TAX_ON_TOP ? beforeTax(amount, TAX_ON_TOP[country] ?? 0).total : amount;

/**
 * Regional (purchasing-power) prices: round local amounts chosen by hand for
 * lower-income markets, not conversions of the US price (ADR-0013, 2026-10-02).
 * Minor units: [month, quarter, year].
 * Volatile currencies (ARS, TRY) are priced in USD. Sanctioned countries,
 * where Paddle doesn't sell, are left out.
 */
const REGIONAL: { countries: string[]; currency: string; amounts: number[] }[] = [
  // Low and lower-middle income, in local currency.
  { countries: ['IN'], currency: 'INR', amounts: [44900, 109900, 369900] },
  { countries: ['VN'], currency: 'VND', amounts: [119000, 299000, 999000] },
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
    ],
    currency: 'USD',
    amounts: [500, 1200, 3900],
  },
  // Upper-middle income, in local currency.
  { countries: ['BR'], currency: 'BRL', amounts: [3290, 7990, 26900] },
  { countries: ['MX'], currency: 'MXN', amounts: [13900, 33900, 114900] },
  {
    countries: ['CO'],
    currency: 'COP',
    amounts: [2590000, 6490000, 21490000],
  },
  { countries: ['ZA'], currency: 'ZAR', amounts: [13900, 33900, 114900] },
  { countries: ['TH'], currency: 'THB', amounts: [24900, 62900, 209000] },
  { countries: ['CN'], currency: 'CNY', amounts: [4900, 11900, 39900] },
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
    amounts: [750, 1900, 5900],
  },
];

interface Override {
  country_codes: string[];
  unit_price: { amount: string; currency_code: string };
}

/** Every local price for one plan and interval: UK, Ireland, Australia, then the regions. */
function overridesFor(tier: Tier, interval: Interval): Override[] {
  const [, gbp, eur, aud] = PRICES[tier][interval];
  const slot = ['month', 'quarter', 'year'].indexOf(interval);
  const groups: Override[] = [];
  for (const r of [...ROUND, ...REGIONAL]) {
    const amount = r.amounts[slot] ?? 0;
    const plain = r.countries.filter((c) => !(c in TAX_ON_TOP));
    if (plain.length)
      groups.push({
        country_codes: plain,
        unit_price: { amount: String(amount), currency_code: r.currency },
      });
    // Tax-on-top countries get their own pre-tax amount, one rate at a time.
    for (const c of r.countries.filter((x) => x in TAX_ON_TOP))
      groups.push({
        country_codes: [c],
        unit_price: {
          amount: String(beforeTax(amount, TAX_ON_TOP[c] ?? 0).net),
          currency_code: r.currency,
        },
      });
  }
  return [
    { country_codes: ['GB'], unit_price: { amount: String(gbp), currency_code: 'GBP' } },
    { country_codes: EUROZONE, unit_price: { amount: String(eur), currency_code: 'EUR' } },
    { country_codes: ['AU'], unit_price: { amount: String(aud), currency_code: 'AUD' } },
    ...groups,
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
const check = process.argv.includes('--check');
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
const ids: Record<Tier, Partial<Record<Interval, string>>> = { pro: {} };

const products = await call<Product[]>('GET', '/products?status=active&per_page=200');
for (const tier of ['pro'] as const) {
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
    const name = `Pro ${LABEL[interval]}`;
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
  if (missing.length) {
    changes.push(`webhook is missing events: ${missing.join(', ')}`);
    if (apply)
      await call('PATCH', `/notification-settings/${hook.id}`, {
        subscribed_events: [...hook.subscribed_events.map((e) => e.name), ...missing],
      });
  }
}

console.log(
  `Paddle ${env}: ${changes.length ? `${apply ? 'applied' : 'would apply'}:` : 'everything is in place.'}`,
);
for (const change of changes) console.log(`  - ${change}`);
console.log(JSON.stringify({ prices: ids }, null, 2));

/**
 * --check: what buyers in each priced country pay at checkout, compared with
 * the round price we meant. Canada is "plus tax" by design (province rates).
 */
if (check) {
  const intended = new Map<string, number[]>();
  for (const r of [...ROUND, ...REGIONAL]) for (const c of r.countries) intended.set(c, r.amounts);
  const order = (['month', 'quarter', 'year'] as const).map((i) => ids.pro[i] ?? '');
  const off: string[] = [];
  for (const [country, amounts] of intended) {
    if (country === 'CA') continue;
    const preview = await call<{
      details: { line_items: { price: { id: string }; totals: { total: string } }[] };
    }>('POST', '/pricing-preview', {
      items: order.map((price_id) => ({ price_id, quantity: 1 })),
      address: { country_code: country },
    });
    preview.details.line_items.forEach((line, i) => {
      const meant = expectedTotal(country, amounts[i] ?? 0);
      if (Number(line.totals.total) !== meant)
        off.push(`${country} ${line.price.id}: total ${line.totals.total}, meant ${String(meant)}`);
    });
  }
  console.log(
    off.length
      ? `Totals that aren't the round price:\n  ${off.join('\n  ')}`
      : `All ${String(intended.size - 1)} countries total exactly the round price.`,
  );
}
