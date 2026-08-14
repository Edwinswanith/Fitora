#!/usr/bin/env bash
# Smoke-test the Google login API workflow (no real Google account needed).
set -euo pipefail

API="${API_BASE:-http://localhost:4000}"
ORIGIN="${ORIGIN:-http://localhost:8081}"

echo "== Google login workflow smoke test =="
echo "API: $API  Origin: $ORIGIN"
echo

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "PASS: $1"; }

# 1. Health
health=$(curl -sf "$API/api/health") || fail "server not reachable at $API"
echo "$health" | grep -q '"status":"ok"' || fail "health check bad payload: $health"
pass "server health"

# 2. CORS preflight (browser sends this before POST)
cors=$(curl -sf -X OPTIONS "$API/api/auth/google" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -D - -o /dev/null) || fail "CORS preflight request failed"
echo "$cors" | grep -qi "access-control-allow-origin: $ORIGIN" || fail "CORS missing Allow-Origin for $ORIGIN"
pass "CORS preflight allows $ORIGIN"

# 3. Unconfigured vs configured
http_code=$(curl -s -o /tmp/google-test-body.json -w "%{http_code}" -X POST "$API/api/auth/google" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"credential":"fake-token","requestedRole":"athlete"}')
resp=$(cat /tmp/google-test-body.json)
[ "$http_code" = "401" ] || fail "expected HTTP 401 for fake token, got $http_code: $resp"
echo "$resp" | grep -q 'google_signin_unconfigured' && fail "GOOGLE_CLIENT_ID not set on server"
echo "$resp" | grep -q 'invalid_google_token' || fail "expected invalid_google_token, got: $resp"
pass "endpoint configured (rejects fake token with invalid_google_token)"

# 4. Missing credential
http_code=$(curl -s -o /tmp/google-test-body.json -w "%{http_code}" -X POST "$API/api/auth/google" \
  -H "Content-Type: application/json" \
  -d '{"requestedRole":"athlete"}')
resp=$(cat /tmp/google-test-body.json)
[ "$http_code" = "400" ] || fail "expected HTTP 400 for missing credential, got $http_code: $resp"
echo "$resp" | grep -q 'missing_credential' || fail "expected missing_credential, got: $resp"
pass "validates required credential field"

# 5. Guardian self-signup blocked (fake token still hits token check first)
http_code=$(curl -s -o /tmp/google-test-body.json -w "%{http_code}" -X POST "$API/api/auth/google" \
  -H "Content-Type: application/json" \
  -d '{"credential":"fake-token","requestedRole":"guardian"}')
resp=$(cat /tmp/google-test-body.json)
echo "$resp" | grep -q 'invalid_google_token\|self_signup_role_not_supported' || fail "guardian role check unexpected ($http_code): $resp"
pass "guardian role path reachable"

echo
echo "All API-layer checks passed."
echo "Browser step: open $ORIGIN/login/athlete and use Google's button (needs localhost:8081 in Google Cloud Console)."
