// rolestash.com/auth/google/: Google returns here with an ID token in the URL
// fragment (ADR-0012). This page forwards the fragment, unchanged, to the
// Rolestash extension named in `state`, and only to Rolestash extensions, or
// to this site's own web board when `state` says "web" (ADR-0017).
// Fragments are never sent to any server, including this one.

// Rolestash extension IDs allowed to receive sign-ins: the pinned
// development/staging ID and the Chrome Web Store ID.
const ALLOWED_EXTENSION_IDS = [
  'bdajnmkjahhphadpdbbkibljcheonejp',
  'cncilbdakhabnocnjokbonggomndedgp',
];

/** Where to forward `hash`, or null when it isn't for a Rolestash extension. */
function forwardTarget(hash) {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const encoded = new URLSearchParams(fragment).get('state');
  if (!encoded) return null;
  let extensionId;
  try {
    extensionId = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))).e;
  } catch {
    return null;
  }
  // Same origin: the web board checks the state against what it stored.
  if (extensionId === 'web') return `/board/#${fragment}`;
  if (!ALLOWED_EXTENSION_IDS.includes(extensionId)) return null;
  return `https://${extensionId}.chromiumapp.org/#${fragment}`;
}

if (typeof location !== 'undefined' && typeof document !== 'undefined') {
  const target = forwardTarget(location.hash);
  if (target) {
    location.replace(target);
  } else {
    const status = document.getElementById('auth-status');
    if (status)
      status.textContent =
        'This sign-in link is invalid or has expired. Open Rolestash and choose "Continue with Google" again.';
  }
}
