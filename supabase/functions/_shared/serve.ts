import { readEnv } from './env.ts';
import { json, type Deps, type FunctionEnv } from './handlers.ts';

/**
 * Wires a handler to Deno.serve with live dependencies. Secrets are read per
 * request, so a function deployed before its secrets are set answers a clear
 * 503 instead of failing to boot.
 */
export function serve(handler: (request: Request, deps: Deps) => Promise<Response>): void {
  Deno.serve((request) => {
    let env: FunctionEnv;
    try {
      env = readEnv((name) => Deno.env.get(name));
    } catch (error) {
      console.error('[rolestash] function not configured', error);
      return json(503, { error: 'not_configured' });
    }
    return handler(request, {
      env,
      fetch: (input, init) => fetch(input, init),
      now: () => new Date(),
    });
  });
}
