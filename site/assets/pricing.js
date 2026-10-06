// rolestash.com/pricing/: prices in the visitor's currency from Paddle
// (PricePreview detects the country from the visitor's IP; we never pass
// one), a monthly/yearly switch, and Subscribe buttons.
//
// Subscribe never opens checkout here: it goes to the web board, which signs
// the buyer in and opens a checkout the server made for that account
// (ADR-0027). A checkout opened in the browser could name anyone's account.
// Edit the tiers below.
import { initPaddle, PADDLE } from './paddle-config.js';

/** @typedef {'month' | 'quarter' | 'year'} Interval */
/** @typedef {{ name: 'Free' | 'Pro', description: string, features: string[], priceId: Record<Interval, string> | null, badge?: string }} Tier */

/** @type {Tier[]} */
const TIERS = [
  {
    name: 'Free',
    description: 'No account needed',
    features: [
      'One-click capture from 50 job sites',
      'Kanban board with notes, tags and priorities',
      'Up to 30 active jobs (rejected ones don’t count)',
      'Autofill your name, contact details and links',
      'CSV and JSON export',
    ],
    priceId: null,
  },
  {
    name: 'Pro',
    description: 'Everything Rolestash does',
    features: [
      'Unlimited active jobs',
      'Status updates from your job emails, with interview details',
      'Full autofill: work details, saved answers, from your résumé',
      'Insights, contacts, documents, reminders and full history',
      'Sync across 5 devices, including your phone',
    ],
    priceId: PADDLE.prices.pro,
    badge: '14-day free trial in the app',
  },
];

/** @type {Record<Interval, string>} */
const PER = { month: ' / month', quarter: ' / 3 months', year: ' / year' };

const grid = document.getElementById('pricing-plans');
const status = document.getElementById('pricing-status');
const toggle = document.querySelectorAll('[data-interval]');
/** @type {Interval} */
let interval = 'month';
/** priceId → Paddle's formatted total for this visitor. */
const totals = new Map();

/** Paddle's "CA$16.99" the way Canadians read it: "$16.99 CAD". Others unchanged. */
export function displayPrice(formatted, currency) {
  if (currency !== 'CAD') return formatted;
  const amount = /\d[\d,]*(?:\.\d+)?/.exec(formatted)?.[0];
  return amount ? `$${amount} CAD` : formatted;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render() {
  if (!grid) return;
  grid.replaceChildren(
    ...TIERS.map((tier) => {
      const card = el('article', tier.badge ? 'plan plan-pro' : 'plan');
      if (tier.badge) card.append(el('span', 'plan-badge', tier.badge));
      card.append(el('h3', '', tier.name));
      const price = el('p', 'price');
      if (tier.priceId) {
        const id = tier.priceId[interval];
        price.textContent = totals.get(id) ?? '…';
        price.append(el('small', '', PER[interval]));
      } else price.textContent = 'Free';
      card.append(price, el('p', 'note', tier.description));
      const list = el('ul');
      for (const feature of tier.features) list.append(el('li', '', feature));
      card.append(list);
      if (tier.priceId) {
        const id = tier.priceId[interval];
        const button = el(
          'button',
          `btn ${tier.badge ? 'btn-primary' : 'btn-ghost'} plan-cta`,
          'Subscribe',
        );
        button.type = 'button';
        button.disabled = !totals.has(id);
        button.addEventListener('click', () => subscribe(tier, interval));
        card.append(button);
      } else {
        const link = el('a', 'btn btn-ghost plan-cta', 'Start free');
        link.href =
          'https://chromewebstore.google.com/detail/rolestash/cncilbdakhabnocnjokbonggomndedgp';
        card.append(link);
      }
      return card;
    }),
  );
  for (const button of toggle)
    button.setAttribute('aria-pressed', String(button.dataset.interval === interval));
}

/** Sign in on the web board, then check out there (src/web/checkout-intent.ts). */
function subscribe(tier, chosen) {
  location.assign(`/board/?checkout=${tier.name.toLowerCase()}-${chosen}`);
}

for (const button of toggle)
  button.addEventListener('click', () => {
    const chosen = button.dataset.interval;
    interval = chosen === 'year' || chosen === 'quarter' ? chosen : 'month';
    render();
  });

render();
try {
  const paddle = initPaddle({});
  const items = TIERS.flatMap((t) => (t.priceId ? Object.values(t.priceId) : [])).map(
    (priceId) => ({ priceId, quantity: 1 }),
  );
  // No address or country: Paddle localizes from the visitor's IP.
  paddle
    .PricePreview({ items })
    .then((result) => {
      for (const line of result.data.details.lineItems)
        totals.set(
          line.price.id,
          displayPrice(line.formattedTotals.total, result.data.currencyCode),
        );
      render();
    })
    .catch((error) => {
      console.error(error);
      if (status) status.textContent = 'Prices couldn’t load. Please refresh the page.';
    });
} catch (error) {
  console.error(error);
  if (status) status.textContent = 'Checkout isn’t available right now. Please try again later.';
}
