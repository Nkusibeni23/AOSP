#!/usr/bin/env bash
# End-to-end smoke test: register user, login, enroll device, send a LOCATE_NOW.
# Run this AFTER `npm run dev` is up.

set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
EMAIL="${EMAIL:-tester@rmsoft.rw}"
PASS="${PASS:-test12345}"

echo "==> register"
curl -s -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"fullName\":\"Tester\"}" | jq . || true

echo "==> login"
TOKENS=$(curl -s -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "$TOKENS" | jq .
ACCESS=$(echo "$TOKENS" | jq -r .accessToken)

echo "==> enroll fake device"
ENROLL=$(curl -s -X POST "$BASE/api/enroll" \
  -H "authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' \
  -d '{"serialNumber":"SHIBA-FAKE-001","model":"Pixel 8","androidVersion":"14","romBuild":"RMSoftOS-0.1"}')
echo "$ENROLL" | jq .
DEVICE_ID=$(echo "$ENROLL" | jq -r .deviceId)

echo "==> list devices"
curl -s "$BASE/api/devices" -H "authorization: Bearer $ACCESS" | jq .

echo "==> issue LOCATE_NOW command"
curl -s -X POST "$BASE/api/devices/$DEVICE_ID/commands" \
  -H "authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' \
  -d '{"type":"LOCATE_NOW"}' | jq .

echo "==> done. Subscribe to MQTT topic device/$DEVICE_ID/commands to see it:"
echo "    mosquitto_sub -t \"device/$DEVICE_ID/commands\" -h localhost -p 1883"
