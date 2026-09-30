import { z } from 'zod';
import { EntitlementSchema, planOf, type Plan, type PlanState } from '@/domain/plan';
import type { KeyValueStore } from '@/storage/key-value-store';
import { ACCOUNT_ENTITLEMENT_KEY, ACCOUNT_SESSION_KEY } from '@/storage/keys';
import {
  BackendError,
  codeChallenge,
  createCodeVerifier,
  SessionSchema,
  type Session,
  type SupabaseClient,
} from './backend/supabase-client';
import type { PlanProvider } from './job-service';
import type { WebAuthFlow } from './ports';

/**
 * Sign-in, the cached entitlement and billing links (ADR-0011). Exists only
 * when the build is configured with a backend; the rest of the app treats a
 * missing AccountService as "accounts off".
 */

const StoredEntitlementSchema = EntitlementSchema.extend({
  hasBillingAccount: z.boolean().default(false),
});
type StoredEntitlement = z.infer<typeof StoredEntitlementSchema>;

export interface AccountState {
  signedIn: boolean;
  email?: string;
  plan: PlanState;
  /** A Paddle customer exists, so "Manage subscription" can open the portal. */
  hasBillingAccount: boolean;
  /** When the entitlement was last confirmed with the server. */
  checkedAt?: string;
}

/** Refresh the access token this long before it expires. */
const TOKEN_SKEW_MS = 60_000;
/** Re-read the entitlement in the background when older than this. */
export const ENTITLEMENT_MAX_AGE_MS = 60 * 60_000;

export class AccountService implements PlanProvider {
  constructor(
    private readonly store: KeyValueStore,
    private readonly client: SupabaseClient,
    private readonly authFlow: WebAuthFlow,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async load(): Promise<{
    session: Session | undefined;
    entitlement: StoredEntitlement | undefined;
  }> {
    const raw = await this.store.get([ACCOUNT_SESSION_KEY, ACCOUNT_ENTITLEMENT_KEY]);
    const session = SessionSchema.safeParse(raw[ACCOUNT_SESSION_KEY]);
    const entitlement = StoredEntitlementSchema.safeParse(raw[ACCOUNT_ENTITLEMENT_KEY]);
    return {
      session: session.success ? session.data : undefined,
      entitlement: entitlement.success ? entitlement.data : undefined,
    };
  }

  async state(): Promise<AccountState> {
    const { session, entitlement } = await this.load();
    const plan = planOf(session ? entitlement : undefined, this.now());
    return {
      signedIn: session !== undefined,
      ...(session?.user.email ? { email: session.user.email } : {}),
      plan,
      hasBillingAccount: session !== undefined && (entitlement?.hasBillingAccount ?? false),
      ...(session && entitlement ? { checkedAt: entitlement.checkedAt } : {}),
    };
  }

  async currentPlan(): Promise<Plan> {
    return (await this.state()).plan.plan;
  }

  /** Fires when the session or entitlement changes in any extension context. */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe((changes) => {
      if (ACCOUNT_SESSION_KEY in changes || ACCOUNT_ENTITLEMENT_KEY in changes) listener();
    });
  }

  async requestEmailCode(email: string): Promise<void> {
    await this.client.sendEmailCode(normalizeEmail(email));
  }

  async verifyEmailCode(email: string, code: string): Promise<void> {
    const session = await this.client.verifyEmailCode(
      normalizeEmail(email),
      code.replace(/\s/g, ''),
    );
    await this.signedIn(session);
  }

  async signInWithGoogle(): Promise<void> {
    const verifier = createCodeVerifier();
    const url = this.client.authorizeUrl(
      'google',
      this.authFlow.redirectUrl(),
      await codeChallenge(verifier),
    );
    const redirected = new URL(await this.authFlow.launch(url));
    const code = redirected.searchParams.get('code');
    if (!code) throw new BackendError('server');
    await this.signedIn(await this.client.exchangeCode(code, verifier));
  }

  private async signedIn(session: Session): Promise<void> {
    await this.store.set({ [ACCOUNT_SESSION_KEY]: session });
    await this.refreshEntitlement();
  }

  /**
   * Re-reads the entitlement. Returns false (keeping the cached one) when the
   * server can't be reached; the offline grace period covers that.
   */
  async refreshEntitlement(): Promise<boolean> {
    try {
      const token = await this.accessToken();
      const remote = await this.client.entitlement(token);
      if (!remote) {
        await this.store.remove([ACCOUNT_ENTITLEMENT_KEY]);
        return true;
      }
      const entitlement: StoredEntitlement = {
        status: remote.status,
        ...(remote.trialEndsAt ? { trialEndsAt: remote.trialEndsAt } : {}),
        ...(remote.currentPeriodEnd ? { currentPeriodEnd: remote.currentPeriodEnd } : {}),
        hasBillingAccount: remote.hasBillingAccount,
        checkedAt: this.now().toISOString(),
      };
      await this.store.set({ [ACCOUNT_ENTITLEMENT_KEY]: entitlement });
      return true;
    } catch (error) {
      if (error instanceof BackendError && (error.code === 'network' || error.code === 'server'))
        return false;
      throw error;
    }
  }

  /** Background refresh when the cached entitlement is old. Never throws. */
  async refreshIfStale(maxAgeMs = ENTITLEMENT_MAX_AGE_MS): Promise<void> {
    const { session, entitlement } = await this.load();
    if (!session) return;
    const age = entitlement ? this.now().getTime() - Date.parse(entitlement.checkedAt) : Infinity;
    if (age < maxAgeMs) return;
    await this.refreshEntitlement().catch(() => undefined);
  }

  async checkoutUrl(interval: 'month' | 'year'): Promise<string> {
    return this.client.functionUrl('create-checkout', await this.accessToken(), { interval });
  }

  async billingPortalUrl(): Promise<string> {
    return this.client.functionUrl('billing-portal', await this.accessToken());
  }

  /** Deletes the account on the server. Jobs on this device are kept. */
  async deleteAccount(): Promise<void> {
    await this.client.deleteAccount(await this.accessToken());
    await this.clear();
  }

  async signOut(): Promise<void> {
    const { session } = await this.load();
    if (session) await this.client.signOut(session.accessToken);
    await this.clear();
  }

  private async clear(): Promise<void> {
    await this.store.remove([ACCOUNT_SESSION_KEY, ACCOUNT_ENTITLEMENT_KEY]);
  }

  /** A valid access token, refreshing it first when close to expiry. */
  private async accessToken(): Promise<string> {
    const { session } = await this.load();
    if (!session) throw new BackendError('session_expired');
    if (session.expiresAt - TOKEN_SKEW_MS > this.now().getTime()) return session.accessToken;
    try {
      const next = await this.client.refresh(session.refreshToken);
      await this.store.set({ [ACCOUNT_SESSION_KEY]: next });
      return next.accessToken;
    } catch (error) {
      if (error instanceof BackendError && error.code === 'session_expired') await this.clear();
      throw error;
    }
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
