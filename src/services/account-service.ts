import { z } from 'zod';
import {
  EntitlementSchema,
  planOf,
  type BillingInterval,
  type PaidPlan,
  type Plan,
  type PlanState,
} from '@/domain/plan';
import type { KeyValueStore } from '@/storage/key-value-store';
import { AccountProfileSchema, firstNameFrom, type AccountProfile } from '@/domain/account-profile';
import {
  ACCOUNT_ENTITLEMENT_KEY,
  ACCOUNT_PROFILE_KEY,
  ACCOUNT_SESSION_KEY,
  ACCOUNT_SHARING_OPT_OUT_KEY,
  ACCOUNT_PRICES_KEY,
  ACCOUNT_NAME_SKIPPED_KEY,
  ACCOUNT_WELCOMED_KEY,
} from '@/storage/keys';
import {
  BackendError,
  randomToken,
  SessionSchema,
  type LocalPrices,
  type PlanChangePreview,
  type Session,
  type SupabaseClient,
} from './backend/supabase-client';
import { googleAuthUrl, readGoogleResult, sha256Hex } from './backend/google';
import type { PlanProvider } from './job-service';
import type { EmailInbox, RemoteJobStore, WebAuthFlow } from './ports';

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
  /** Full name and picture (ADR-0022, ADR-0024), as last read or saved. */
  profile: AccountProfile;
  /** Full name: the one saved on the account, else the one Google gave. */
  name?: string;
  /** First name to greet by: from the name, or a best guess from the email. */
  firstName?: string;
  /** Ask once for a name: signed in, no name anywhere, and not skipped. */
  needsName: boolean;
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
    profile: AccountProfile;
  }> {
    const raw = await this.store.get([
      ACCOUNT_SESSION_KEY,
      ACCOUNT_ENTITLEMENT_KEY,
      ACCOUNT_PROFILE_KEY,
    ]);
    const session = SessionSchema.safeParse(raw[ACCOUNT_SESSION_KEY]);
    const entitlement = StoredEntitlementSchema.safeParse(raw[ACCOUNT_ENTITLEMENT_KEY]);
    const profile = AccountProfileSchema.safeParse(raw[ACCOUNT_PROFILE_KEY]);
    return {
      session: session.success ? session.data : undefined,
      entitlement: entitlement.success ? entitlement.data : undefined,
      profile: profile.success ? profile.data : {},
    };
  }

  async state(): Promise<AccountState> {
    const { session, entitlement, profile } = await this.load();
    const plan = planOf(session ? entitlement : undefined, this.now());
    const name = session ? (profile.displayName ?? session.user.name) : undefined;
    const skipped = (await this.store.get([ACCOUNT_NAME_SKIPPED_KEY]))[ACCOUNT_NAME_SKIPPED_KEY];
    return {
      signedIn: session !== undefined,
      ...(session?.user.email ? { email: session.user.email } : {}),
      plan,
      hasBillingAccount: session !== undefined && (entitlement?.hasBillingAccount ?? false),
      ...(session && entitlement ? { checkedAt: entitlement.checkedAt } : {}),
      profile: session ? profile : {},
      ...(name ? { name } : {}),
      ...(session && firstNameFrom(name, session.user.email)
        ? { firstName: firstNameFrom(name, session.user.email) }
        : {}),
      needsName: session !== undefined && !name && skipped !== session.user.id,
    };
  }

  async currentPlan(): Promise<Plan> {
    return (await this.state()).plan.plan;
  }

  async onTrial(): Promise<boolean> {
    return (await this.state()).plan.reason === 'trial';
  }

  /** Fires when the session or entitlement changes in any extension context. */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe((changes) => {
      if (
        ACCOUNT_SESSION_KEY in changes ||
        ACCOUNT_ENTITLEMENT_KEY in changes ||
        ACCOUNT_PROFILE_KEY in changes
      )
        listener();
    });
  }

  /** Whether "Continue with Google" should be offered. False when unknown (offline). */
  async googleSignInAvailable(): Promise<boolean> {
    if (!this.client.config.googleClientId) return false;
    try {
      return (await this.client.oauthProviders()).google;
    } catch {
      return false;
    }
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

  /** Google sign-in via an ID token and rolestash.com's forwarding page (ADR-0012). */
  async signInWithGoogle(): Promise<void> {
    const clientId = this.client.config.googleClientId;
    if (!clientId) throw new BackendError('server');
    const extensionId = new URL(this.authFlow.redirectUrl()).hostname.split('.')[0] ?? '';
    const nonce = randomToken();
    const state = { e: extensionId, s: randomToken() };
    const url = googleAuthUrl({ clientId, nonceHash: await sha256Hex(nonce), state });
    const idToken = readGoogleResult(await this.authFlow.launch(url), state);
    await this.signedIn(await this.client.signInWithIdToken(idToken, nonce));
  }

  /**
   * Finishes a Google sign-in whose redirect landed on a web page rather than
   * in launchWebAuthFlow (the web board; ADR-0017). The caller has checked
   * `state` and kept the raw nonce.
   */
  async completeGoogleSignIn(idToken: string, rawNonce: string): Promise<void> {
    await this.signedIn(await this.client.signInWithIdToken(idToken, rawNonce));
  }

  /** Signs in with a single-use token minted by another signed-in client. */
  async signInWithHandoff(tokenHash: string): Promise<void> {
    await this.signedIn(await this.client.verifyTokenHash(tokenHash));
  }

  /** A single-use token for the web board, from this signed-in client. */
  async webHandoffToken(): Promise<string> {
    return this.client.webHandoff(await this.accessToken());
  }

  private async signedIn(session: Session): Promise<void> {
    await this.store.set({ [ACCOUNT_SESSION_KEY]: session });
    await this.refreshEntitlement();
    await this.refreshProfile().catch(() => undefined);
    await this.welcomeOnce().catch(() => undefined);
  }

  /**
   * Requests the welcome email after a sign-in (ADR-0024). The server sends
   * it once per account; this device stops asking once the server answered.
   */
  async welcomeOnce(): Promise<void> {
    const { session } = await this.load();
    if (!session) return;
    const done = (await this.store.get([ACCOUNT_WELCOMED_KEY]))[ACCOUNT_WELCOMED_KEY];
    if (done === session.user.id) return;
    await this.client.sendWelcome(await this.accessToken());
    await this.store.set({ [ACCOUNT_WELCOMED_KEY]: session.user.id });
  }

  /** Saves the account's full name (keeps the picture). */
  async saveName(name: string): Promise<void> {
    const { profile } = await this.load();
    await this.saveProfile({ ...profile, displayName: name });
  }

  /** "Skip" on the one-time name question; the name can still be added in Account. */
  async skipName(): Promise<void> {
    const { session } = await this.load();
    if (session) await this.store.set({ [ACCOUNT_NAME_SKIPPED_KEY]: session.user.id });
  }

  /**
   * The "Help improve automatic updates" choice made while signing in
   * (ADR-0019, ADR-0022). On is the default and changes nothing; off is kept
   * on this device until the server has it, so it survives being offline.
   */
  async chooseSharingAtSignIn(on: boolean): Promise<void> {
    if (on) await this.store.remove([ACCOUNT_SHARING_OPT_OUT_KEY]);
    else await this.store.set({ [ACCOUNT_SHARING_OPT_OUT_KEY]: true });
  }

  private async applySharingOptOut(token: string): Promise<void> {
    const pending = (await this.store.get([ACCOUNT_SHARING_OPT_OUT_KEY]))[
      ACCOUNT_SHARING_OPT_OUT_KEY
    ];
    if (pending !== true) return;
    await this.client.setEmailSharing(token, false);
    await this.store.remove([ACCOUNT_SHARING_OPT_OUT_KEY]);
  }

  /**
   * Re-reads the name and picture. An account with no saved name takes the
   * one Google gave, so Paddle and every device see it too (ADR-0024).
   */
  async refreshProfile(): Promise<AccountProfile> {
    const profile = await this.client.accountProfile(await this.accessToken());
    await this.store.set({ [ACCOUNT_PROFILE_KEY]: profile });
    const { session } = await this.load();
    const fromGoogle = session?.user.name?.trim();
    if (!profile.displayName && fromGoogle) {
      const named = AccountProfileSchema.safeParse({ ...profile, displayName: fromGoogle });
      if (named.success) {
        await this.saveProfile(named.data).catch(() => undefined);
        return named.data;
      }
    }
    return profile;
  }

  /** Saves the display name and picture; leaving one out clears it. */
  async saveProfile(profile: AccountProfile): Promise<void> {
    const parsed = AccountProfileSchema.parse(profile);
    const { session } = await this.load();
    if (!session) throw new BackendError('session_expired');
    await this.client.saveAccountProfile(await this.accessToken(), session.user.id, parsed);
    await this.store.set({ [ACCOUNT_PROFILE_KEY]: parsed });
  }

  /**
   * Re-reads the entitlement. Returns false (keeping the cached one) when the
   * server can't be reached; the offline grace period covers that.
   */
  async refreshEntitlement(): Promise<boolean> {
    try {
      const token = await this.accessToken();
      // A sign-in opt-out that couldn't reach the server yet; retried here.
      await this.applySharingOptOut(token).catch(() => undefined);
      const remote = await this.client.entitlement(token);
      if (!remote) {
        await this.store.remove([ACCOUNT_ENTITLEMENT_KEY]);
        return true;
      }
      const entitlement: StoredEntitlement = {
        status: remote.status,
        ...(remote.trialEndsAt ? { trialEndsAt: remote.trialEndsAt } : {}),
        ...(remote.currentPeriodEnd ? { currentPeriodEnd: remote.currentPeriodEnd } : {}),
        tier: remote.tier,
        hasBillingAccount: remote.hasBillingAccount,
        ...(remote.complimentary ? { complimentary: true } : {}),
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

  /** Checkout for a new subscription (Free, trial or lapsed accounts). */
  async checkoutUrl(tier: PaidPlan, interval: BillingInterval): Promise<string> {
    return this.client.functionUrl('create-checkout', await this.accessToken(), {
      tier,
      interval,
    });
  }

  /**
   * Plan prices in this user's currency, cached for a day; undefined when
   * they can't be fetched (callers then show US prices).
   */
  async localPrices(): Promise<LocalPrices | undefined> {
    const cached = (await this.store.get([ACCOUNT_PRICES_KEY]))[ACCOUNT_PRICES_KEY] as
      { at: number; value: LocalPrices } | undefined;
    const now = this.now().getTime();
    if (cached && now - cached.at < 86_400_000) return cached.value;
    try {
      const value = await this.client.localPrices();
      await this.store.set({ [ACCOUNT_PRICES_KEY]: { at: now, value } });
      return value;
    } catch {
      return cached?.value;
    }
  }

  /** What switching would charge or credit now; shown for confirmation first. */
  async previewPlanChange(tier: PaidPlan, interval: BillingInterval): Promise<PlanChangePreview> {
    return this.client.previewPlanChange(await this.accessToken(), { tier, interval });
  }

  /** Switches a live subscription between Pro and Advanced, then re-reads the plan. */
  async changePlan(tier: PaidPlan, interval: BillingInterval): Promise<void> {
    await this.client.changePlan(await this.accessToken(), { tier, interval });
    await this.refreshEntitlement();
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
    await this.store.remove([
      ACCOUNT_SESSION_KEY,
      ACCOUNT_ENTITLEMENT_KEY,
      ACCOUNT_PROFILE_KEY,
      ACCOUNT_SHARING_OPT_OUT_KEY,
      ACCOUNT_PRICES_KEY,
      ACCOUNT_NAME_SKIPPED_KEY,
    ]);
  }

  /** Sync's server calls, made as the signed-in user (ADR-0016). */
  remoteJobStore(): RemoteJobStore {
    const call = async <T>(run: (token: string) => Promise<T>) => run(await this.accessToken());
    return {
      registerDevice: (device) => call((t) => this.client.registerDevice(t, device)),
      listDevices: () => call((t) => this.client.listDevices(t)),
      removeDevice: (id) => call((t) => this.client.removeDevice(t, id)),
      push: (deviceId, changes) => call((t) => this.client.pushJobs(t, deviceId, changes)),
      pull: (deviceId, after, limit) =>
        call((t) => this.client.pullJobs(t, deviceId, after, limit)),
    };
  }

  /** Email updates' server calls, made as the signed-in user (ADR-0014). */
  emailInbox(): EmailInbox {
    const call = async <T>(run: (token: string) => Promise<T>) => run(await this.accessToken());
    return {
      address: (rotate = false) => call((t) => this.client.myInbox(t, rotate)),
      events: (after, limit) => call((t) => this.client.emailEvents(t, after, limit)),
      remove: (ids) => call((t) => this.client.deleteEmailEvents(t, ids)),
      vote: (votes) => call((t) => this.client.voteEmailKnowledge(t, votes)),
      setSharing: (on) => call((t) => this.client.setEmailSharing(t, on)),
    };
  }

  /** A valid access token, refreshing it first when close to expiry. */
  /** A fresh access token for first-party calls made on the account's behalf. */
  token(): Promise<string> {
    return this.accessToken();
  }

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
