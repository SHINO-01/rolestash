import { createServer, type IncomingMessage, type Server } from 'node:http';

/**
 * A stand-in for the Supabase endpoints the extension calls, on the fixed
 * address baked into E2E builds by `.env.e2e`. Records every request so tests
 * can assert on what the extension sent.
 */
export const MOCK_BACKEND_PORT = 54399;
export const MOCK_BACKEND = `http://127.0.0.1:${String(MOCK_BACKEND_PORT)}`;
export const E2E_CODE = '123456';

export interface MockRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export interface MockBackend {
  requests: MockRequest[];
  /** The entitlement row returned to the signed-in user. */
  entitlement: Record<string, unknown>;
  close(): Promise<void>;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const TOKEN = {
  access_token: 'e2e-access',
  refresh_token: 'e2e-refresh',
  expires_in: 3600,
  user: { id: 'e2e-user', email: 'jo@example.com' },
};
const PAGE = '<!doctype html><title>Mock checkout</title><h1>Checkout</h1>';

function route(path: string, body: unknown, state: MockBackend): [number, unknown, string?] {
  switch (path) {
    case '/auth/v1/settings':
      return [200, { external: { email: true, google: true } }];
    case '/auth/v1/otp':
      return [200, {}];
    case '/auth/v1/verify':
      return (body as { token?: string } | null)?.token === E2E_CODE
        ? [200, TOKEN]
        : [403, { error_code: 'otp_expired' }];
    case '/auth/v1/token':
      return [200, TOKEN];
    case '/auth/v1/logout':
      return [204, ''];
    case '/rest/v1/entitlements':
      return [200, [state.entitlement]];
    case '/functions/v1/create-checkout':
      return [200, { url: `${MOCK_BACKEND}/pay/?_ptxn=txn_e2e` }];
    case '/functions/v1/billing-portal':
      return [200, { url: `${MOCK_BACKEND}/portal` }];
    case '/functions/v1/delete-account':
      return [200, { deleted: true }];
    case '/pay/':
    case '/portal':
      return [200, PAGE, 'text/html'];
    default:
      return [404, { error: 'not_found' }];
  }
}

export async function startMockBackend(): Promise<MockBackend> {
  const state: MockBackend = {
    requests: [],
    entitlement: {
      status: 'trialing',
      trial_ends_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      current_period_end: null,
      provider_customer_id: null,
    },
    close: () => Promise.resolve(),
  };

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS).end();
        return;
      }
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      state.requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body });
      const [status, payload, type = 'application/json'] = route(path, body, state);
      res.writeHead(status, { ...CORS, 'Content-Type': type });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    });
  });
  await new Promise<void>((r) => server.listen(MOCK_BACKEND_PORT, '127.0.0.1', r));
  state.close = async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  return state;
}
