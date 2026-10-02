// Public Paddle settings for rolestash.com: checkout (/pay/) and the pricing
// page (/pricing/). Client-side tokens and price IDs are public by design
// (Paddle > Developer tools > Authentication). Sandbox tokens start with
// test_, production tokens with live_.
//
// GOING LIVE: change all three together, in one reviewed commit — the
// environment, the live client token, and the live price IDs.

export const PADDLE = {
  environment: 'production',
  token: 'live_0ec65d3d8ea14ba4c9a617381d7',
  prices: {
    pro: {
      month: 'pri_01m3y715y2eep9wssnpra9e239',
      quarter: 'pri_01m3y7167ce2c70mpmneqctxsk',
      year: 'pri_01m3y716j3y2va7xyhpxzhj2xs',
    },
    advanced: {
      month: 'pri_01m3y718bn1h0vjn0eyep7s0yq',
      quarter: 'pri_01m3y718m74mxxmh6ncza0fbbd',
      year: 'pri_01m3y718xs5rrc4fe760rfzd95',
    },
  },
};

/** Checkout follows the visitor's light or dark setting, like rolestash.com.
 * The brand colour (#0B5D52, Rolestash spruce) is set in Paddle's dashboard. */
export function checkoutTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Loads Paddle.js for the configured environment, failing loudly (never
 * silently falling back to a default) if the settings don't match each other.
 */
export function initPaddle(options) {
  const { environment, token } = PADDLE;
  if (environment !== 'sandbox' && environment !== 'production')
    throw new Error('paddle-config.js: environment must be "sandbox" or "production"');
  const expected = environment === 'sandbox' ? 'test_' : 'live_';
  if (!token.startsWith(expected))
    throw new Error(`paddle-config.js: a ${environment} token must start with ${expected}`);
  if (typeof window.Paddle === 'undefined') throw new Error('Paddle.js did not load');
  if (environment === 'sandbox') window.Paddle.Environment.set('sandbox');
  window.Paddle.Initialize({ token, ...options });
  return window.Paddle;
}
