#!/bin/sh
# This branch's API, on this Mac, for a test build on a phone on the same Wi-Fi.
#
#   sh scripts/local-test-server.sh
#
# Never the production database: every variable that could point at one is
# removed before the server starts, and storage is a Redis of its own on port
# 6380 with its data in .local-test/ (ignored by git), so test sales survive a
# restart and nothing here can reach a real account. Stop it with Ctrl-C.
set -e
cd "$(dirname "$0")/.."
mkdir -p .local-test/redis
if ! redis-cli -p 6380 ping >/dev/null 2>&1; then
  redis-server --port 6380 --dir "$PWD/.local-test/redis" --appendonly yes --daemonize yes >/dev/null
fi
[ -f .local-test/secret ] || head -c 24 /dev/urandom | base64 > .local-test/secret
echo "Test server: http://$(scutil --get LocalHostName).local:3001 (Ctrl-C to stop)"
exec env -u DATABASE_URL -u POSTGRES_URL -u KV_URL -u KV_REST_API_URL -u KV_REST_API_TOKEN \
  -u LOYVERSE_ACCESS_TOKEN -u POS_ACCESS_TOKEN \
  REDIS_URL=redis://127.0.0.1:6380 SESSION_SECRET="$(cat .local-test/secret)" ADMIN_EMAIL=owner@test.local \
  node server.js
