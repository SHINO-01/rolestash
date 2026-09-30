import { handleLaunchList, readLaunchEnv, type LaunchEnv } from '../_shared/launch-list.ts';

// Secrets are read per request, so a missing one answers 503 instead of
// failing to boot (like ../_shared/serve.ts, without the Paddle secrets).
Deno.serve((request) => {
  let env: LaunchEnv;
  try {
    env = readLaunchEnv((name) => Deno.env.get(name));
  } catch (error) {
    console.error('[rolestash] launch-list not configured', error);
    return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 });
  }
  return handleLaunchList(request, { env, fetch: (input, init) => fetch(input, init) });
});
