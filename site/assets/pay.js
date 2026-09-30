// Checkout for rolestash.com/pay/?_ptxn=txn_… (ADR-0011). The extension's
// create-checkout function returns this URL; Paddle.js opens the transaction
// named in `_ptxn`. This page is the only one that loads third-party code.
//
// Client-side tokens are public by design (Paddle > Developer tools >
// Authentication). Sandbox tokens start with test_, production with live_.
const PADDLE = { environment: 'sandbox', token: 'test_d7e463f467c037e2f530ec28c61' };

const status = document.getElementById('pay-status');
const show = (message) => {
  if (status) status.textContent = message;
};

const transaction = new URLSearchParams(location.search).get('_ptxn');
if (!transaction) {
  show('There is no checkout to open here. Start from Account in the Rolestash extension.');
} else if (!PADDLE.token || typeof window.Paddle === 'undefined') {
  show(
    "Checkout isn't available right now. Please try again later, or email support@rolestash.com.",
  );
} else {
  if (PADDLE.environment === 'sandbox') window.Paddle.Environment.set('sandbox');
  window.Paddle.Initialize({
    token: PADDLE.token,
    checkout: {
      settings: { displayMode: 'overlay', successUrl: `${location.origin}/pay/success/` },
    },
    eventCallback(event) {
      if (event.name === 'checkout.closed') show('Checkout closed. You can close this tab.');
    },
  });
}
