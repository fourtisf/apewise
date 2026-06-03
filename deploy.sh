#!/usr/bin/env bash
#
# ApeWise — VPS redeploy.
# Pulls latest code, installs deps, rebuilds, and reloads the PM2 process
# with zero-downtime. Run from the app directory on the server (e.g. /var/www/apewise).
#
# Usage:  ./deploy.sh
#
set -euo pipefail

APP_NAME="apewise"
BRANCH="${DEPLOY_BRANCH:-main}"

echo "▶ Deploying ${APP_NAME} (branch: ${BRANCH})"

# 1. Pull latest code
echo "▶ Pulling latest…"
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"

# 2. Install exactly what's in the lockfile
echo "▶ Installing dependencies…"
npm ci

# 3. Production build
echo "▶ Building…"
npm run build

# 4. Reload (zero-downtime) or start if not yet running
if pm2 describe "${APP_NAME}" > /dev/null 2>&1; then
  echo "▶ Reloading PM2 process…"
  pm2 reload "${APP_NAME}"
else
  echo "▶ Starting PM2 process…"
  pm2 start npm --name "${APP_NAME}" -- start
  pm2 save
fi

echo "✅ Deploy complete."
