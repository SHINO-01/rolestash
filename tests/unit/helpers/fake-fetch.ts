/**
 * A fetch stand-in for backend tests: routes by "METHOD url-without-query"
 * (or "METHOD url-prefix*"), records every call, and fails loudly on anything
 * unexpected, so tests never touch the network.
 */

export interface FakeResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export function fakeFetch(
  routes: Record<string, FakeResponse | ((call: RecordedCall) => FakeResponse)>,
) {
  const calls: RecordedCall[] = [];
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const raw = typeof init.body === 'string' ? init.body : undefined;
    const call: RecordedCall = {
      method,
      url,
      headers: Object.fromEntries(
        new Headers(init.headers).entries().map(([k, v]) => [
          // Keep the caller's casing for common headers so assertions read naturally.
          k === 'authorization' ? 'Authorization' : k === 'content-type' ? 'Content-Type' : k,
          v,
        ]),
      ),
      body: raw === undefined ? undefined : (JSON.parse(raw) as unknown),
    };
    calls.push(call);
    const bare = `${method} ${url.split('?')[0] ?? url}`;
    const route =
      routes[bare] ??
      Object.entries(routes).find(
        ([key]) => key.endsWith('*') && `${method} ${url}`.startsWith(key.slice(0, -1)),
      )?.[1];
    if (!route) return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    const res = typeof route === 'function' ? route(call) : route;
    return Promise.resolve(
      new Response(res.status === 204 ? null : JSON.stringify(res.body), {
        status: res.status,
        ...(res.headers ? { headers: res.headers } : {}),
      }),
    );
  };
  return { fetch: fetch, calls };
}
