#!/usr/bin/env bash
#
# Daily refresh of the Helius enhanced webhook so the *dynamic* Birdeye
# smart-money leaderboard stays in sync with the registered address set.
# setup-helius-webhook.mjs is idempotent (it removes the previous webhook for
# the same URL), so re-running converges to exactly one webhook.
#
# Install (root crontab, 06:00 UTC daily):
#   chmod +x scripts/refresh-webhook.sh
#   ( crontab -l 2>/dev/null | grep -v refresh-webhook.sh; \
#     echo "0 6 * * * /var/www/apewise/scripts/refresh-webhook.sh >> /var/log/apewise-webhook.log 2>&1" ) | crontab -
#
set -euo pipefail

# cron runs with a minimal PATH — make sure node is found.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

# App dir = parent of this script, regardless of the caller's CWD.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Export ONLY the vars the setup script needs, read literally from .env so values
# containing ? or & (e.g. RPC URLs) are never re-interpreted by the shell.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}" # tolerate CRLF
    case "$line" in
      HELIUS_API_KEY=*|WEBHOOK_URL=*|INGEST_SECRET=*|BIRDEYE_API_KEY=*|BIRDEYE_TRACK_LIMIT=*|BIRDEYE_PAGE_DELAY_MS=*|SMART_WALLETS_FILE=*|USE_GMGN_WALLETS=*)
        export "$line"
        ;;
    esac
  done < .env
fi

echo "=== $(date -u +%FT%TZ) refreshing Helius webhook ==="
node scripts/setup-helius-webhook.mjs
echo "=== done ==="
