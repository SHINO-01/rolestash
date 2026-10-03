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

1. Get the API credentials by following
   [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys)
   (client ID, client secret, refresh token). The publisher ID is in the
   dashboard's account settings.
2. From a clone of this repo, run `bash scripts/setup-github.sh --store` and
   paste the values when asked. From then on, _Release_ uploads and submits
   each new version once you approve the `chrome-web-store` environment.

## 5. Google brand verification (owner)

Google Cloud console → **Google Auth Platform → Branding** for the OAuth
client in `.env.staging`:

- App name **Rolestash**, a 120×120 px logo (resize `brand/png/rolestash-mark-512.png`), and support email
  support@rolestash.com;
- home page `https://rolestash.com/`, privacy policy
  `https://rolestash.com/privacy/`, terms `https://rolestash.com/terms/`;
- authorised domain `rolestash.com`;
- then **Verify branding**. The domain must be verified in Search Console
  for the same Google account.

## 6. Beta (owner, with us)

Send the unlisted link to 10–20 testers. Ask them to capture a few jobs,
try autofill on a real form, export a backup, and (for some) sign in and
start the Advanced trial. Collect issues at support@rolestash.com. Ship
fixes as patch releases.

## 7. Going public

When the beta is clean and the owner says go:

1. **Owner:** dashboard → **Distribution → Visibility → Public**, then
   submit.
2. **Ours:** merge the launch-day branch (`claude/dreamy-cray-1377h7`)
   into `dev`. It holds:
   - store links on the homepage hero and plan buttons, and the
     `/pricing/` free plan, instead of `/#notify`;
   - the closing section as an "Add to Chrome" call to action, with the
     form kept as an optional product-news signup;
   - `/pricing/` in the nav and in search results (no `noindex`);
   - the privacy policy without "Accounts are launching soon".

   Before merging, replace `STORE_ID` in the store links with the item ID
   (`grep -rl STORE_ID site | xargs sed -i 's/STORE_ID/<id>/g'`), and set
   "Last updated" on the privacy policy to the launch date.

3. **Ours:** deploy the launch-list function so its confirmation emails
   talk about product news, not the launch:
   `npx supabase functions deploy launch-list --project-ref fhclnxqumcdsqxyunelp --use-api`.
4. **Owner says go, then ours:** **Actions → Announce launch** with the
   store URL: _send_ off first (a dry run that shows the count), then on
   (docs/guides/launch-list.md).
