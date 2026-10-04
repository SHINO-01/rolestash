# Launching on the Chrome Web Store

The runbook for Phase 1d (roadmap): an unlisted beta first, then public.
Steps marked **owner** need the owner's accounts; everything else is ours.

## 1. Build the release with accounts on (owner)

The release repo's _Release_ workflow runs daily at 20:17 UTC (06:17
Sydney) and releases the newest source tag. It builds only once per tag, so
set the accounts variables **before** it builds the version you'll upload.

1. In GitHub → **SHINO-01/rolestash-extension → Settings → Secrets and
   variables → Actions → Variables → New repository variable**, add these
   three. They're public values; copy them from `.env.staging` in this repo:
   - `WXT_SUPABASE_URL`
   - `WXT_SUPABASE_ANON_KEY`
   - `WXT_GOOGLE_CLIENT_ID`
2. **Actions → Release → Run workflow** (branch `main`).
3. When it finishes, open the new release and download the zip. Check that:
   - its `manifest.json` has the release version, `identity`, and
     `externally_connectable` with only `https://rolestash.com/board/*`;
   - it has no `key` field (the store assigns the ID).

If a tag was already released without the variables, cut a new patch
release here (`npm run release -- patch`) so _Release_ builds again.

## 2. First upload, unlisted (owner)

1. Go to the [developer dashboard](https://chrome.google.com/webstore/devconsole),
   sign in with the Google account that should own the listing, and pay the
   one-time US$5 registration fee.
2. In **Account**, verify the contact email, then fill in the trader
   declaration: you are a **trader** (Lumetrix Technologies, a sole
   trader, ABN 41 649 439 228). The dashboard asks for the address, phone
   and email that EU users will see.
3. **Items → New item**, then upload the zip from step 1.
4. Fill in each tab from `store/listing.md` in the release repo:
   - **Store listing:** name, summary, description, category, language,
     the five screenshots in `store/screenshots/`, and the 128 px icon
     from the package.
   - **Privacy:** the single purpose, a justification for each permission,
     "No, I am not using remote code", the data usage disclosures and the
     three certifications. Privacy policy URL:
     `https://rolestash.com/privacy/`.
   - **Distribution:** free of charge (the paid plans are sold through
     Paddle, not the store), all regions, and visibility **Unlisted**.
5. **Submit for review.** Untick "publish automatically" if you'd rather
   publish by hand after approval.
6. If it's rejected, the email quotes the offending text. The first review
   flagged the list of job-site names in the description as keyword spam;
   describe supported sites in general terms instead.
7. Copy the **item ID** (32 letters, shown on the item page and in its
   URL) and send it to us.

Approved: v0.4.0 was published, unlisted, on 4 October 2026 (after two
rejections for naming job sites in the description). v0.4.1 went to review
the same day; v0.4.0 stays installable while it's reviewed.

## 3. Wire the store ID in (ours, after the owner sends the ID)

Done 2026-10-03: the item ID is `cncilbdakhabnocnjokbonggomndedgp`.

In one commit on `dev`:

- add the ID to `ROLESTASH_EXTENSION_IDS` in `src/services/web-handoff.ts`
  **and** to `ALLOWED_EXTENSION_IDS` in `site/assets/auth-google.js` (a site
  test keeps them equal). Without it, "Continue with Google" and the web
  board's sign-in hand-off refuse the store build.

The hand-off pages deploy with the site when CI promotes, so this must land
before beta testers try Google sign-in.

## 4. Automatic uploads (owner)

Done 2026-10-03, in the Cloud project `rolestash-cws-upload`.

1. Get the API credentials by following
   [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys)
   (client ID, client secret, refresh token), signed in as the account that
   owns the store item. Three things the guide doesn't say:
   - Use a **separate** Cloud project, not the one with the sign-in client:
     its consent screen is verified, and changing it would undo that.
   - With a Gmail account, pick audience **External**, fill in the home page
     and privacy URLs on **Branding** (no logo, so no verification), then
     **Audience → Publish app**. In _Testing_, Google expires the refresh
     token after 7 days.
   - If `npx chrome-webstore-upload-keys` fails with `ETIMEDOUT` after the
     approval code, the network is slower than Node's 250 ms per-address
     limit. Run it with
     `NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"`.
     The approval code works once, so start again from the top.
2. From a clone of this repo, run `bash scripts/setup-github.sh --store` and
   paste the values when asked. The publisher ID is the first ID in the
   dashboard URL (also under **Account**). The last prompt is the
   **extension ID**, which is stored as a plain variable: check it isn't the
   refresh token still on the clipboard. If a token ever lands there, revoke
   it at myaccount.google.com/connections, make a new one, and set
   `CWS_REFRESH_TOKEN` again.
3. From then on, _Release_ uploads and submits each new version once you
   approve the `chrome-web-store` environment.
4. **Check them:** in rolestash-extension, run **Actions → Check store
   credentials** and approve it. It names an empty or misplaced secret and
   asks Google whether the client ID, secret and refresh token work
   together, without printing them. _Release_ runs the same check before
   each upload. (The v0.4.1 upload failed on an empty `CWS_PUBLISHER_ID`,
   then on "The OAuth client was not found", meaning `CWS_CLIENT_ID` didn't
   match a client.) To replace one value:
   `gh secret set CWS_CLIENT_ID --repo SHINO-01/rolestash-extension --env chrome-web-store`.

## 5. Google brand verification (owner)

Done: Google verified the app (2026-10-03).

Google Cloud console → **Google Auth Platform → Branding** for the OAuth
client in `.env.staging`:

- App name **Rolestash**, a 120×120 px logo (resize `brand/png/rolestash-mark-512.png`), and support email
  support@rolestash.com;
- home page `https://rolestash.com/`, privacy policy
  `https://rolestash.com/privacy/`, terms `https://rolestash.com/terms/`;
- authorised domain `rolestash.com`;
- then **Verify branding**. The domain must be verified in Search Console
  for the same Google account.

## v0.4.1 in review (to do)

All open items across the launch, search and operations work are also in
[todo.md](../todo.md).

Submitted 2026-10-04 (release run 37192004589). Until it's approved:

- [ ] **Owner:** paste the data disclosures from the release repo's
      `store/listing.md` ("Collected" section) into the dashboard's
      **Privacy** tab. Reviewers compare them with what 0.4.1 does; they
      now include account names and problem reports.
- [ ] **Owner:** start the beta (step 6) on the unlisted link; testers move
      to 0.4.1 automatically once it's approved.

When Google approves 0.4.1:

- [ ] **Ours:** on rolestash.com/known-issues/, move the three issues fixed
      in 0.4.1 out of _Open_ (the changelog records the fixes), and set
      "Current version" to 0.4.1 and "Last updated" to that day.

## 6. Beta (owner, with us)

Send the unlisted link to 10–20 testers. Ask them to capture a few jobs,
try autofill on a real form, export a backup, and (for some) sign in and
start the Advanced trial. Collect issues at support@rolestash.com. Ship
fixes as patch releases.

## 7. Going public

When the beta is clean and the owner says go:

1. **Owner:** dashboard → **Distribution → Visibility → Public**, then
   submit.
2. ~~**Ours:** merge the launch-day branch~~ done early, on 2026-10-03,
   while the item was still in review (the owner chose to keep it live; its
   store buttons work once the item is published). The branch
   (`claude/dreamy-cray-1377h7`) held:
   - store links on the homepage hero and plan buttons, and the
     `/pricing/` free plan, instead of `/#notify`;
   - the closing section as an "Add to Chrome" call to action, with the
     form kept as an optional product-news signup;
   - `/pricing/` in the nav and in search results (no `noindex`);
   - the privacy policy without "Accounts are launching soon".

   The store links use the item ID, and the privacy policy's "Last
   updated" is 3 October 2026.

3. ~~**Ours:** deploy the launch-list function, then run **Actions →
   Announce launch**~~ scrapped by the owner on 2026-10-05: no launch
   announcement email. The product-news list and form stay.
   - **Open question:** the deployed function's confirmation and welcome
     emails still promise new subscribers an email "on launch day". The
     repo's version (unchanged since) says product news instead; deploying
     it fixes the wording only:
     `npx supabase functions deploy launch-list --project-ref fhclnxqumcdsqxyunelp --use-api`.
