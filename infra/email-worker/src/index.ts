import { handleEmail, type Env, type IncomingEmail } from './handle';

/**
 * Cloudflare Email Worker entry. Every message is accepted and then either
 * stored as an event or silently dropped: bouncing would tell a sender which
 * addresses exist. Only the outcome is logged, never the address or content.
 */
export default {
  async email(message: IncomingEmail, env: Env): Promise<void> {
    const outcome = await handleEmail(message, env);
    console.log(`email: ${outcome}`);
  },
};
