// rolestash.com/pricing/: prices in the visitor's currency from Paddle
// (PricePreview detects the country from the visitor's IP; we never pass
// one), a monthly/yearly switch, and Subscribe buttons that open Paddle's
// one-page overlay checkout for exactly the price shown.
//
// Purchases here carry no Rolestash account: the billing webhook links them
// to the account with the checkout email (creating it if needed), so buyers
// sign in to the extension with that email. Edit the tiers below.
import { initPaddle, PADDLE } from './paddle-config.js';

/** @typedef {{ name: 'Free' | 'Pro' | 'Advanced', description: string, features: string[], priceId: { month: string, year: string } | null, badge?: string }} Tier */

/** @type {Tier[]} */
const TIERS = [
  {
    name: 'Free',
    description: 'No account needed',
    features: [
      'One-click capture from 50+ sites',
      'Kanban board with notes, tags and priorities',
      'Up to 15 active jobs',
      'CSV and JSON export',
    ],
    priceId: null,
  },
  {
    name: 'Pro',
    description: 'Everything on your computer',
    features: [
      'Up to 60 active jobs',
      'Application autofill, from your profile or résumé',
      'Insights, contacts, documents and bulk actions',
      'Reminders, custom columns and full history',
      'Sync across up to 3 computers',
    ],
    priceId: PADDLE.prices.pro,
  },
  {
    name: 'Advanced',
    description: 'Plus automatic updates and your phone',
    features: [
      'Unlimited active jobs',
      'Automatic status updates from your job emails',
      'Interview details on each card',
      'Sync across up to 5 devices, including your phone',
      'Your whole board in the side panel',
    ],
    priceId: PADDLE.prices.advanced,
    badge: '14-day free trial in the app',
  },
];

const grid = document.getElementById('pricing-plans');
const status = document.getElementById('pricing-status');
const toggle = document.querySelectorAll('[data-interval]');
/** @type {'month' | 'year'} */
let interval = 'month';
/** priceId → Paddle's formatted total for this visitor. */
const totals = new Map();

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
        price.append(el('small', '', interval === 'month' ? ' / month' : ' / year'));
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
        button.addEventListener('click', () => subscribe(id));
        card.append(button);
      } else {
        const link = el('a', 'btn btn-ghost plan-cta', 'Start free');
        link.href = '/#notify';
        card.append(link);
      }
      return card;
    }),
  );
  for (const button of toggle)
    button.setAttribute('aria-pressed', String(button.dataset.interval === interval));
}

function subscribe(priceId) {
  window.Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    settings: {
      displayMode: 'overlay',
      variant: 'one-page',
      successUrl: `${location.origin}/welcome/`,
    },
  });
}

for (const button of toggle)
  button.addEventListener('click', () => {
    interval = button.dataset.interval === 'year' ? 'year' : 'month';
    render();
  });

render();
try {
  const paddle = initPaddle({});
  const items = TIERS.flatMap((t) => (t.priceId ? [t.priceId.month, t.priceId.year] : [])).map(
    (priceId) => ({ priceId, quantity: 1 }),
  );
  // No address or country: Paddle localizes from the visitor's IP.
  paddle
    .PricePreview({ items })
    .then((result) => {
      for (const line of result.data.details.lineItems)
        totals.set(line.price.id, line.formattedTotals.total);
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
