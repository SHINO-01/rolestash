// Public Paddle settings for rolestash.com: checkout (/pay/) and the pricing
// page (/pricing/). Client-side tokens and price IDs are public by design
// (Paddle > Developer tools > Authentication). Sandbox tokens start with
// test_, production tokens with live_.
//
// GOING LIVE: change all three together, in one reviewed commit — the
// environment, the live client token, and the live price IDs.

export const PADDLE = {
  environment: 'sandbox',
  token: 'test_d7e463f467c037e2f530ec28c61',
  prices: {
    pro: {
      month: 'pri_01m3s73v5t0r2zqzz8wct746xv',
      quarter: 'pri_01m3y3y6de3wsfs82jd8ymn0xa',
      year: 'pri_01m3s73vs4yxfg6t659v7a5tct',
    },
    advanced: {
      month: 'pri_01m3st08htr3cj786030yfbbth',
      quarter: 'pri_01m3y3y70ea10p5n29f6yd6z5s',
      year: 'pri_01m3st08x58jpvrawjpsrdyj3e',
    },
  },
};

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
