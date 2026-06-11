#!/usr/bin/env bash
set -euo pipefail

# Applies the rewrite rules in amplify-custom-rules.json to the Amplify app:
#   /api/<*>  -> 200 reverse-proxy to the CloudFront distribution
#   SPA regex -> 200 rewrite to /index.html
#
# WebSocket (/ws) cannot proxy through Amplify rewrites -- the client connects
# directly to the CloudFront distribution via VITE_API_URL (existing behavior).

APP_ID="${AMPLIFY_APP_ID:-d22gnzk10dja9z}"
RULES_FILE="$(cd "$(dirname "$0")" && pwd)/amplify-custom-rules.json"

aws amplify update-app \
  --app-id "$APP_ID" \
  --custom-rules "file://$RULES_FILE"
