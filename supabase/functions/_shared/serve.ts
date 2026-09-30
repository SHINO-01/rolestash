import { readEnv } from './env.ts';
import type { Deps } from './handlers.ts';

/** Wires a handler to Deno.serve with live dependencies. */
export function serve(handler: (request: Request, deps: Deps) => Promise<Response>): void {
  const deps: Deps = {
    env: readEnv((name) => Deno.env.get(name)),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  };
  Deno.serve((request) => handler(request, deps));
}
