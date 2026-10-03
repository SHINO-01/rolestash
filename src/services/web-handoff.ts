/**
 * Signing the web board in from the extension (ADR-0017). The board, when
 * signed out, messages the extension (allowed by its externally_connectable
 * key); a signed-in extension answers with a single-use token from the
 * web-handoff function, which the board exchanges for its own session.
 */
export const WEB_HANDOFF_MESSAGE = 'rolestash:web-handoff';

export interface WebHandoffReply {
  tokenHash?: string;
}

/**
 * Rolestash extension IDs the board asks: the pinned development/staging ID,
 * and the Chrome Web Store ID. Keep in step with
 * site/assets/auth-google.js (a test checks).
 */
export const ROLESTASH_EXTENSION_IDS = [
  'bdajnmkjahhphadpdbbkibljcheonejp',
  'cncilbdakhabnocnjokbonggomndedgp',
] as const;
