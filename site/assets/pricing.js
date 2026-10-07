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

/**
 * A promo code (?code=) or referral link (/r/<code> → ?ref=), kept in this tab
 * only (sessionStorage, no cookies) until the web board sends it to
 * create-checkout, which checks it (ADR-0035). Same key as src/web/checkout-intent.ts.
 */
const PROMO_KEY = 'rolestash:promo';
const CODE = /^[A-Za-z0-9_-]{2,40}$/;

/** @returns {{ code?: string, ref?: string }} */
function readPromo() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROMO_KEY) ?? '{}');
    /** @type {{ code?: string, ref?: string }} */
    const promo = {};
    if (typeof stored.code === 'string' && CODE.test(stored.code)) promo.code = stored.code;
    if (typeof stored.ref === 'string' && CODE.test(stored.ref)) promo.ref = stored.ref;
    return promo;
  } catch {
    return {};
  }
}

/** @param {{ code?: string, ref?: string }} promo */
function savePromo(promo) {
  try {
    if (promo.code || promo.ref) sessionStorage.setItem(PROMO_KEY, JSON.stringify(promo));
    else sessionStorage.removeItem(PROMO_KEY);
  } catch {
    // Private mode: the code just won't carry over.
  }
}

/** Moves ?code= and ?ref= from the address bar into this tab's storage. */
function takePromoFromUrl() {
  const url = new URL(location.href);
  const promo = readPromo();
  for (const key of /** @type {const} */ (['code', 'ref'])) {
    const value = url.searchParams.get(key)?.trim();
    if (value && CODE.test(value)) promo[key] = value.toUpperCase();
    url.searchParams.delete(key);
  }
  savePromo(promo);
  history.replaceState(history.state, '', url);
}

const codeBox = document.getElementById('pricing-code');

function renderCode() {
  if (!codeBox) return;
  const promo = readPromo();
  const parts = [];
  if (promo.ref)
    parts.push(
      el(
        'span',
        'code-applied',
        'A friend sent you: money off your first month on the monthly plan, applied at checkout.',
      ),
    );
  if (promo.code) {
    const applied = el('span', 'code-applied', `Code ${promo.code} will be applied at checkout. `);
    const remove = el('button', 'link-button', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      savePromo({ ...(promo.ref ? { ref: promo.ref } : {}) });
      renderCode();
    });
    applied.append(remove);
    parts.push(applied);
  } else {
    const open = el('button', 'link-button', 'Have a code?');
    open.type = 'button';
    open.addEventListener('click', () => {
      const form = el('form');
      const input = /** @type {HTMLInputElement} */ (el('input'));
      input.name = 'code';
      input.autocomplete = 'off';
      input.maxLength = 40;
      input.placeholder = 'Code';
      input.setAttribute('aria-label', 'Discount or referral code');
      const apply = el('button', 'btn btn-sm btn-ghost', 'Apply');
      apply.type = 'submit';
      form.append(input, apply);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!CODE.test(value)) {
          input.setCustomValidity('Letters, numbers, - and _ only');
          input.reportValidity();
          return;
        }
        savePromo({ ...readPromo(), code: value.toUpperCase() });
        renderCode();
      });
      input.addEventListener('input', () => input.setCustomValidity(''));
      open.replaceWith(form);
      input.focus();
    });
    parts.push(open);
  }
  codeBox.replaceChildren(...parts);
}

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

takePromoFromUrl();
renderCode();
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
