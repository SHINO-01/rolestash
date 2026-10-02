// Checkout for rolestash.com/pay/?_ptxn=txn_… (ADR-0011). The extension's
// create-checkout function returns this URL; Paddle.js opens the transaction
// named in `_ptxn`. Only /pay/ and /pricing/ load third-party code.
import { initPaddle } from './paddle-config.js';

const status = document.getElementById('pay-status');
const show = (message) => {
  if (status) status.textContent = message;
};

const transaction = new URLSearchParams(location.search).get('_ptxn');
if (!transaction) {
  show('There is no checkout to open here. Start from Account in the Rolestash extension.');
} else {
  try {
    initPaddle({
      checkout: {
        settings: { displayMode: 'overlay', successUrl: `${location.origin}/pay/success/` },
      },
      eventCallback(event) {
        if (event.name === 'checkout.closed') show('Checkout closed. You can close this tab.');
      },
    });
  } catch (error) {
    console.error(error);
    show(
      "Checkout isn't available right now. Please try again later, or email support@rolestash.com.",
    );
  }
}
