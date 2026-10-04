#!/usr/bin/env bash
# One-time GitHub configuration for both repositories — settings as code.
# Idempotent: safe to re-run after changing anything below.
#
#   gh auth login                        # as the repo owner, once
#   bash scripts/setup-github.sh         # repo settings, security, rulesets, environment
#   bash scripts/setup-github.sh --store # additionally prompt for Chrome Web Store credentials
#
# What it does and why: docs/guides/ci-cd.md → "Repository settings".
set -euo pipefail

OWNER="${OWNER:-SHINO-01}"
SRC="${OWNER}/rolestash"
EXT="${OWNER}/rolestash-extension"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
# GitHub occasionally answers 502/503/504; retry those with backoff. Other
# errors (403, 404, 422) are real and fail at once.
api() {
  local attempt err
  err="$(mktemp)"
  for attempt in 1 2 3 4 5; do
    if if [[ -n "${API_BODY-}" ]]; then
      printf '%s' "$API_BODY" | gh api -H "X-GitHub-Api-Version: 2022-11-28" --input - "$@" 2>"$err"
    else
      gh api -H "X-GitHub-Api-Version: 2022-11-28" "$@" 2>"$err"
    fi; then
      rm -f "$err"
      return 0
    fi
    if grep -q 'HTTP 50[234]' "$err" && ((attempt < 5)); then
      echo "  (GitHub returned a server error; retrying in $((attempt * 3))s)" >&2
      sleep $((attempt * 3))
      continue
    fi
    cat "$err" >&2
    rm -f "$err"
    return 1
  done
}
json() { API_BODY="$(cat)" api "$@"; } # body from stdin
soft() { "$@" >/dev/null 2>&1 || echo "  (skipped: $* — not available for this repo/plan)"; }

command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null

upsert_ruleset() { # repo name json
  local repo="$1" name="$2" body="$3" id
  id="$(api "repos/${repo}/rulesets" --jq ".[] | select(.name == \"${name}\") | .id" || true)"
  if [[ -n "$id" ]]; then
    json -X PUT "repos/${repo}/rulesets/${id}" <<<"$body" >/dev/null
  else
    json -X POST "repos/${repo}/rulesets" <<<"$body" >/dev/null
  fi
  echo "  ruleset: ${name}"
}

harden_repo() { # repo
  local repo="$1"
  say "Hardening ${repo}"
  json -X PATCH "repos/${repo}" >/dev/null <<'JSON'
{ "has_wiki": false, "has_projects": false, "delete_branch_on_merge": true,
  "allow_rebase_merge": false, "allow_update_branch": true }
JSON
  # Actions: read-only token by default (jobs opt in to write); only GitHub-authored actions.
  json -X PUT "repos/${repo}/actions/permissions/workflow" >/dev/null <<'JSON'
{ "default_workflow_permissions": "read", "can_approve_pull_request_reviews": false }
JSON
  if ! json -X PUT "repos/${repo}/actions/permissions" >/dev/null 2>&1 <<'JSON'
{ "enabled": true, "allowed_actions": "selected", "sha_pinning_required": true }
JSON
  then
    json -X PUT "repos/${repo}/actions/permissions" >/dev/null <<'JSON'
{ "enabled": true, "allowed_actions": "selected" }
JSON
  fi
  json -X PUT "repos/${repo}/actions/permissions/selected-actions" >/dev/null <<'JSON'
{ "github_owned_allowed": true, "verified_allowed": false, "patterns_allowed": [] }
JSON
  echo "  actions: read-only token, GitHub-owned actions only"

  # Security features (free for public repositories).
  json -X PATCH "repos/${repo}" >/dev/null <<'JSON'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" } } }
JSON
  soft api -X PUT "repos/${repo}/vulnerability-alerts"
  soft api -X PUT "repos/${repo}/automated-security-fixes"
  soft api -X PUT "repos/${repo}/private-vulnerability-reporting"
  soft json -X PATCH "repos/${repo}/code-scanning/default-setup" <<<'{"state":"configured","query_suite":"default"}'
  echo "  security: secret scanning + push protection, Dependabot alerts/fixes, CodeQL, private reporting"

  upsert_ruleset "$repo" "tags: immutable releases" '{
    "name": "tags: immutable releases", "target": "tag", "enforcement": "active",
    "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
    "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" } ] }'
}

# ---------------------------------------------------------------- source
harden_repo "$SRC"
json -X PATCH "repos/${SRC}" >/dev/null <<<'{"default_branch":"dev"}'
echo "  default branch: dev"

# Required checks = the job names in .github/workflows/ci.yml. integration_id 15368 is
# GitHub Actions, so only Actions (not any status poster) can satisfy them.
upsert_ruleset "$SRC" "main: tested commits only" '{
  "name": "main: tested commits only", "target": "branch", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" }, { "type": "non_fast_forward" },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "Quality", "integration_id": 15368 },
          { "context": "Unit tests & coverage", "integration_id": 15368 },
          { "context": "E2E", "integration_id": 15368 },
          { "context": "Database", "integration_id": 15368 } ] } } ] }'
upsert_ruleset "$SRC" "dev: no rewrites" '{
  "name": "dev: no rewrites", "target": "branch", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/dev"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ] }'

# ---------------------------------------------------------------- extension
harden_repo "$EXT"
upsert_ruleset "$EXT" "main: no rewrites" '{
  "name": "main: no rewrites", "target": "branch", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ] }'

say "Chrome Web Store environment on ${EXT}"
owner_id="$(api "users/${OWNER}" --jq .id)"
json -X PUT "repos/${EXT}/environments/chrome-web-store" >/dev/null <<JSON
{ "wait_timer": 0, "prevent_self_review": false,
  "reviewers": [ { "type": "User", "id": ${owner_id} } ],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
soft json -X POST "repos/${EXT}/environments/chrome-web-store/deployment-branch-policies" <<<'{"name":"main","type":"branch"}'
echo "  environment: chrome-web-store (approval by ${OWNER}, main branch only)"

if [[ "${1:-}" == "--store" ]]; then
  say "Chrome Web Store credentials (input is hidden; see rolestash-extension README → One-time setup)"
  # Each prompt says what it wants, and an empty answer asks again: an empty
  # CWS_PUBLISHER_ID once failed the v0.4.1 upload. Values go to gh on stdin,
  # never on the command line.
  prompts=(
    "CWS_PUBLISHER_ID|Publisher ID (first ID in the developer dashboard's address)"
    "CWS_CLIENT_ID|OAuth client ID (ends in .apps.googleusercontent.com)"
    "CWS_CLIENT_SECRET|OAuth client secret (starts GOCSPX-)"
    "CWS_REFRESH_TOKEN|Refresh token (starts 1//)"
  )
  for prompt in "${prompts[@]}"; do
    name="${prompt%%|*}"
    value=""
    while [[ -z "$value" ]]; do
      read -r -s -p "  ${prompt#*|}: " value
      echo
      [[ -z "$value" ]] && echo "  Empty; paste the value (input is hidden)."
    done
    if [[ "$name" == CWS_CLIENT_ID && "$value" != *.apps.googleusercontent.com ]]; then
      echo "  That isn't a client ID. Run the script again." >&2
      exit 1
    fi
    printf '%s' "$value" | gh secret set "$name" --repo "$EXT" --env chrome-web-store
    unset value
  done
  read -r -p "Extension ID (from the Web Store dashboard): " extension_id
  gh variable set CWS_EXTENSION_ID --repo "$EXT" --body "$extension_id"
  echo "  store publishing enabled. Check it: ${EXT} → Actions → Check store credentials"
fi

say "Done."
