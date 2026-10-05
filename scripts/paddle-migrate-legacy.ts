/**
 * Moves every live subscription on a price from before the plans merged
 * (US$7 Pro, US$15 Advanced; ADR-0029) to today's Pro price for the same
 * interval. Nothing is charged now: the change uses `do_not_bill`, so the new
 * price applies from the subscriber's next renewal. Subscriptions already
 * set to cancel are left alone.
 *
 * The terms promise 30 days' emailed notice before a price change applies at
 * renewal. Run --apply only once every listed subscriber was emailed at least
 * 30 days before their next bill (the dry run prints each one's date).
 *
 *   set -a; . ./secrets.env; set +a
 *   npx tsx scripts/paddle-migrate-legacy.ts production            # dry run: who would move
 *   npx tsx scripts/paddle-migrate-legacy.ts production --apply    # move them
 *
 * Today's prices are found the same way paddle-setup.ts finds them: the Pro
 * product's active USD price for each interval at the amounts below.
 */

type Interval = 'month' | 'quarter' | 'year';

const CURRENT_USD: Record<Interval, number> = { month: 1200, quarter: 3000, year: 9900 };

const arg = process.argv[2];
const apply = process.argv.includes('--apply');
if (arg !== 'sandbox' && arg !== 'production') {
  console.error('Usage: paddle-migrate-legacy.ts <sandbox|production> [--apply]');
  process.exit(2);
}
const key = arg === 'sandbox' ? process.env.PADDLE_API_KEY : process.env.PADDLE_LIVE_API_KEY;
if (!key) {
  console.error(`Missing ${arg === 'sandbox' ? 'PADDLE_API_KEY' : 'PADDLE_LIVE_API_KEY'}.`);
  process.exit(2);
}
const base = arg === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

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

interface Price {
  id: string;
  product_id: string;
  billing_cycle: { interval: string; frequency: number } | null;
  unit_price: { amount: string; currency_code: string };
  custom_data: { tier?: string } | null;
}
interface Subscription {
  id: string;
  status: string;
  next_billed_at: string | null;
  scheduled_change: { action: string } | null;
  items: { price: Price }[];
}

const intervalOf = (cycle: Price['billing_cycle']): Interval | undefined =>
  cycle?.interval === 'year' && cycle.frequency === 1
    ? 'year'
    : cycle?.interval === 'month' && cycle.frequency === 3
      ? 'quarter'
      : cycle?.interval === 'month' && cycle.frequency === 1
        ? 'month'
        : undefined;

const products = await call<{ id: string; custom_data: { app?: string; tier?: string } | null }[]>(
  'GET',
  '/products?per_page=200',
);
const ours = products.filter((p) => p.custom_data?.app === 'rolestash');
const pro = ours.find((p) => p.custom_data?.tier === 'pro');
if (!pro) throw new Error('No Rolestash Pro product in Paddle.');

const proPrices = await call<Price[]>(
  'GET',
  `/prices?product_id=${pro.id}&status=active&per_page=200`,
);
const current: Partial<Record<Interval, string>> = {};
for (const price of proPrices) {
  const interval = intervalOf(price.billing_cycle);
  if (
    interval &&
    price.unit_price.currency_code === 'USD' &&
    Number(price.unit_price.amount) === CURRENT_USD[interval]
  )
    current[interval] = price.id;
}
if (!current.month || !current.quarter || !current.year)
  throw new Error('Run paddle-setup.ts --apply first: a current Pro price is missing.');
const currentIds = new Set(Object.values(current));

const moves: { sub: Subscription; from: Price; to: string }[] = [];
const skipped: string[] = [];
for (const status of ['active', 'trialing', 'past_due', 'paused']) {
  let after = '';
  for (;;) {
    const page = await call<Subscription[]>(
      'GET',
      `/subscriptions?status=${status}&per_page=200${after ? `&after=${after}` : ''}`,
    );
    for (const sub of page) {
      const from = sub.items[0]?.price;
      if (!from || currentIds.has(from.id)) continue;
      if (!ours.some((p) => p.id === from.product_id)) continue;
      if (sub.scheduled_change?.action === 'cancel') {
        skipped.push(`${sub.id}: set to cancel, left alone`);
        continue;
      }
      const interval = intervalOf(from.billing_cycle);
      if (!interval) {
        skipped.push(`${sub.id}: unknown billing cycle, left alone`);
        continue;
      }
      moves.push({ sub, from, to: current[interval] ?? '' });
    }
    if (page.length < 200) break;
    after = page.at(-1)?.id ?? '';
  }
}

console.log(
  `Paddle ${arg}: ${String(moves.length)} subscription(s) on older prices${apply ? '' : ' (dry run)'}.`,
);
for (const { sub, from, to } of moves) {
  const was = `${from.custom_data?.tier ?? '?'} ${from.unit_price.currency_code} ${String(Number(from.unit_price.amount) / 100)}`;
  console.log(
    `  ${sub.id} [${sub.status}] ${was} → ${to}, from the bill on ${sub.next_billed_at ?? 'n/a'}`,
  );
  if (apply)
    await call('PATCH', `/subscriptions/${sub.id}`, {
      items: [{ price_id: to, quantity: 1 }],
      proration_billing_mode: 'do_not_bill',
    });
}
for (const line of skipped) console.log(`  skipped ${line}`);
if (apply && moves.length) console.log('Moved. The webhook records each change as it arrives.');
