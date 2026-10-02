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
    const [usd, gbp, eur, aud] = PRICES[tier][interval];
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
      unit_price_overrides: [
        { country_codes: ['GB'], unit_price: { amount: String(gbp), currency_code: 'GBP' } },
        { country_codes: ['IE'], unit_price: { amount: String(eur), currency_code: 'EUR' } },
        { country_codes: ['AU'], unit_price: { amount: String(aud), currency_code: 'AUD' } },
      ],
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
