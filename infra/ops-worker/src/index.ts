import { handle } from './app';
import type { Env } from './panels';

/** Cloudflare Worker entry for operations.rolestash.com (ADR-0026). */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, { fetch: (input, init) => fetch(input, init), now: new Date() });
  },
};
