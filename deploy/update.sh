#!/usr/bin/env bash
# Redeploy the running site from origin/main. Run on the server:
#   /opt/armlex/deploy/update.sh
set -euo pipefail
cd /opt/armlex

git pull --ff-only origin main
npm ci --include=dev --no-audit --no-fund
npm run build

# Before the restart, never after. The runner is forward-only and records what
# it has applied, so running it every deploy is a no-op when there is nothing
# new — and the alternative is a restarted process meeting a schema that lacks
# the column it was just taught to read.
npm run migrate

# /api/version reads RENDER_GIT_COMMIT, which on Render was injected by the
# platform. Nothing injects it here, so without this line the deployed commit
# silently keeps reporting whatever it said the first time — the version
# endpoint would look healthy while naming the wrong build.
sed -i '/^RENDER_GIT_COMMIT=/d' .env
echo "RENDER_GIT_COMMIT=$(git rev-parse HEAD)" >> .env

systemctl restart armlex
sleep 6
curl -fsS --max-time 20 http://127.0.0.1:3001/api/health
echo
curl -fsS --max-time 20 http://127.0.0.1:3001/api/version
echo
