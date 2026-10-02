import { createServer, type IncomingMessage, type Server } from 'node:http';

/**
 * A stand-in for the Supabase endpoints the extension calls, on the fixed
 * address baked into E2E builds by `.env.e2e`. Records every request so tests
 * can assert on what the extension sent.
 */
export const MOCK_BACKEND_PORT = 54399;
export const MOCK_BACKEND = `http://127.0.0.1:${String(MOCK_BACKEND_PORT)}`;
export const E2E_CODE = '123456';
/** What the mock's web-handoff function mints, and its verify accepts once. */
export const E2E_HANDOFF = 'e2e-handoff-hash';

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
  /** Sync (ADR-0016): registered devices and synced rows, newest edit wins. */
  devices: { id: string; name: string; kind: string }[];
  synced: Map<string, { data: unknown; deleted: boolean; updated_at: string; revision: number }>;
  revision: number;
  /** Email updates (ADR-0014): stored events, as the Email Worker writes them. */
  emailEvents: { id: number; event: unknown }[];
  /** Shared-learning votes received (ADR-0014 §6). */
  votes: unknown[];
  /** Account profile (ADR-0022) and the shared-learning switch. */
  profile: { display_name: string | null; avatar: string | null } | undefined;
  shareLearning: boolean;
  close(): Promise<void>;
}

export const E2E_INBOX = 'k3x9q2w7m4p8r5t6abcd@in.rolestash.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const TOKEN = {
  access_token: 'e2e-access',
  refresh_token: 'e2e-refresh',
  expires_in: 3600,
  user: { id: 'e2e-user', email: 'jo@example.com' },
};
const PAGE = '<!doctype html><title>Mock checkout</title><h1>Checkout</h1>';

function route(
  method: string,
  path: string,
  body: unknown,
  state: MockBackend,
): [number, unknown, string?] {
  const b = (body ?? {}) as Record<string, unknown>;
  switch (path) {
    case '/rest/v1/rpc/register_device':
      if (!state.devices.some((d) => d.id === b.p_id))
        state.devices.push({ id: String(b.p_id), name: String(b.p_name), kind: String(b.p_kind) });
      return [200, { ok: true }];
    case '/rest/v1/devices':
      if (method === 'DELETE') {
        state.devices = [];
        return [204, ''];
      }
      return [
        200,
        state.devices.map((d) => ({
          ...d,
          created_at: '2026-10-01T00:00:00Z',
          last_seen_at: new Date().toISOString(),
        })),
      ];
    case '/rest/v1/rpc/push_jobs': {
      let applied = 0;
      for (const c of b.p_changes as {
        id: string;
        updatedAt: string;
        deleted?: boolean;
        data?: unknown;
      }[]) {
        const current = state.synced.get(c.id);
        if (current && current.updated_at >= c.updatedAt) continue;
        state.synced.set(c.id, {
          data: c.deleted ? null : c.data,
          deleted: c.deleted ?? false,
          updated_at: c.updatedAt,
          revision: ++state.revision,
        });
        applied++;
      }
      return [200, applied];
    }
    case '/rest/v1/rpc/pull_jobs':
      return [
        200,
        [...state.synced.entries()]
          .filter(([, r]) => r.revision > Number(b.p_after))
          .sort(([, x], [, y]) => x.revision - y.revision)
          .map(([job_id, r]) => ({ job_id, ...r })),
      ];
    case '/rest/v1/rpc/my_inbox':
    case '/rest/v1/rpc/rotate_inbox':
      return [
        200,
        {
          ok: true,
          address: E2E_INBOX,
          created_at: '2026-10-01T00:00:00Z',
          share_learning: state.shareLearning,
        },
      ];
    case '/rest/v1/rpc/set_email_sharing':
      state.shareLearning = b.p_on === true;
      return [200, { ok: true, share_learning: state.shareLearning }];
    case '/rest/v1/account_profiles':
      if (method === 'POST') {
        state.profile = {
          display_name: (b.display_name as string | null) ?? null,
          avatar: (b.avatar as string | null) ?? null,
        };
        return [201, ''];
      }
      return [200, state.profile ? [state.profile] : []];
    case '/rest/v1/rpc/vote_email_knowledge':
      state.votes.push(...(b.p_votes as unknown[]));
      return [200, { ok: true, recorded: (b.p_votes as unknown[]).length }];
    case '/rest/v1/email_events':
      if (method === 'DELETE') {
        state.emailEvents = [];
        return [204, ''];
      }
      return [200, state.emailEvents];
    case '/auth/v1/settings':
      return [200, { external: { email: true, google: true } }];
    case '/auth/v1/otp':
      return [200, {}];
    case '/auth/v1/verify':
      return b.token === E2E_CODE || b.token_hash === E2E_HANDOFF
        ? [200, TOKEN]
        : [403, { error_code: 'otp_expired' }];
    case '/functions/v1/web-handoff':
      return [200, { tokenHash: E2E_HANDOFF }];
    case '/auth/v1/token':
      return [200, TOKEN];
    case '/auth/v1/logout':
      return [204, ''];
    case '/rest/v1/entitlements':
      return [200, [state.entitlement]];
    case '/functions/v1/create-checkout':
      return [200, { url: `${MOCK_BACKEND}/pay/?_ptxn=txn_e2e` }];
    case '/functions/v1/change-plan':
      return b.preview === true
        ? [
            200,
            {
              preview: {
                action: 'charge',
                amount: 848,
                currency: 'USD',
                recurring: 1500,
                nextBilledAt: '2031-11-02T12:00:00Z',
              },
            },
          ]
        : [200, { changed: true }];
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
      tier: 'advanced',
      trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      current_period_end: null,
      provider_customer_id: null,
    },
    devices: [],
    synced: new Map(),
    revision: 0,
    emailEvents: [],
    votes: [],
    profile: undefined,
    shareLearning: true,
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
      const [status, payload, type = 'application/json'] = route(
        req.method ?? 'GET',
        path,
        body,
        state,
      );
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
