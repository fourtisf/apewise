#!/usr/bin/env bash
#
# ApeWise — VPS teardown. The inverse of deploy.sh.
#
# Takes ApeWise fully offline and removes it from the server, in the only order
# that actually works:
#
#   1. Back up what cannot be regenerated (.env keys, data/, the server-only
#      worker scripts, and the PM2 dump) OUTSIDE the app directory.
#   2. Stop apewise-watchdog FIRST — it resurrects the app, so deleting
#      anything before it just gets undone.
#   3. Delete every apewise-* PM2 process, then `pm2 save` so a reboot's
#      `pm2 resurrect` cannot bring them back.
#   4. Disable the Nginx vhost, so the domain stops serving a 502.
#   5. Delete the app directory.
#
# volread-* processes are never touched.
#
# Usage:
#   ./teardown.sh                    # DRY RUN — prints the plan, changes nothing
#   ./teardown.sh --yes              # execute
#   ./teardown.sh --yes --keep-files # PM2 + Nginx only, leave the directory on disk
#   ./teardown.sh --yes --keep-nginx # leave the Nginx vhost enabled
#
set -euo pipefail

DRY=1
KEEP_FILES=0
KEEP_NGINX=0

usage() { sed -n '2,25p' "$0" | sed 's/^#\s\?//'; }

for arg in "$@"; do
  case "$arg" in
    --yes|-y)      DRY=0 ;;
    --keep-files)  KEEP_FILES=1 ;;
    --keep-nginx)  KEEP_NGINX=1 ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!  %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✔  %s\033[0m\n' "$*"; }

# Run a command, or just print it when dry.
run() {
  if [ "$DRY" -eq 1 ]; then
    printf '   \033[2mwould run:\033[0m %s\n' "$*"
  else
    printf '   %s\n' "$*"
    "$@"
  fi
}

# Same as run(), but a non-zero exit is reported instead of aborting: one
# process that is already gone must never leave the teardown half-finished.
run_soft() {
  if [ "$DRY" -eq 1 ]; then
    printf '   \033[2mwould run:\033[0m %s\n' "$*"
  else
    printf '   %s\n' "$*"
    "$@" || warn "'$*' exited non-zero — continuing."
  fi
}

INVOKED_FROM="$PWD"

command -v pm2 >/dev/null 2>&1 || { echo "pm2 not found in PATH — run this on the VPS as the user that owns the PM2 daemon." >&2; exit 1; }

# ── Discover what we are about to remove ─────────────────────────────────────
# Names come from PM2 itself, filtered to exactly `apewise` and `apewise-*`,
# so a typo can never take out volread-*.
PM2_JSON="$(pm2 jlist 2>/dev/null || echo '[]')"

read_pm2() { printf '%s' "$PM2_JSON" | node -e "$1"; }

PROCS="$(read_pm2 '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const i = s.indexOf("["); if (i < 0) return;
    let list = []; try { list = JSON.parse(s.slice(i)); } catch { return; }
    console.log(list
      .map(p => p.name)
      .filter(n => n === "apewise" || (typeof n === "string" && n.startsWith("apewise-")))
      .join("\n"));
  });')"

APP_DIR="$(read_pm2 '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const i = s.indexOf("["); if (i < 0) return;
    let list = []; try { list = JSON.parse(s.slice(i)); } catch { return; }
    const app = list.find(p => p.name === "apewise") || list.find(p => (p.name || "").startsWith("apewise-"));
    console.log((app && app.pm2_env && app.pm2_env.pm_cwd) || "");
  });')"
APP_DIR="${APP_DIR:-/var/www/apewise}"

APP_PORT="$(read_pm2 '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const i = s.indexOf("["); if (i < 0) return;
    let list = []; try { list = JSON.parse(s.slice(i)); } catch { return; }
    const app = list.find(p => p.name === "apewise");
    console.log((app && app.pm2_env && app.pm2_env.env && app.pm2_env.env.PORT) || "");
  });')"
APP_PORT="${APP_PORT:-3000}"

if [ -z "$PROCS" ]; then
  warn "No apewise-* processes are registered with PM2 (already removed?)."
else
  say "PM2 processes to remove"
  printf '%s\n' "$PROCS" | sed 's/^/   - /'
fi

say "App directory"
echo "   $APP_DIR $([ -d "$APP_DIR" ] || echo '(not present)')"

# A deploy checkout that has drifted from its remote holds commits that exist
# nowhere else. They ride along in the backup (.git is included), but say so
# out loud before anything is deleted.
if [ -d "$APP_DIR/.git" ]; then
  UNPUSHED="$(git -C "$APP_DIR" log --oneline --all --not --remotes 2>/dev/null || true)"
  if [ -n "$UNPUSHED" ]; then
    say "Commits on this server that are not on any remote"
    printf '%s\n' "$UNPUSHED" | sed 's/^/   /'
    warn "These exist only here. They are captured in the backup below (.git is"
    warn "included); push them first if you want them on GitHub."
  fi
  DIRTY="$(git -C "$APP_DIR" status --porcelain 2>/dev/null || true)"
  if [ -n "$DIRTY" ]; then
    warn "Uncommitted changes in $APP_DIR (also captured in the backup):"
    printf '%s\n' "$DIRTY" | sed 's/^/   /'
  fi
fi

if [ "$DRY" -eq 1 ]; then
  warn "DRY RUN — nothing below is executed. Re-run with --yes to apply."
fi

# ── 1. Backup (always, and always outside APP_DIR) ───────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-$HOME}"
BACKUP="${BACKUP_DIR}/apewise-backup-${STAMP}.tar.gz"

say "Backing up to ${BACKUP}"
if [ -d "$APP_DIR" ]; then
  # Everything irreplaceable: .env (Helius/Telegram/Twitter keys, INGEST_SECRET),
  # data/ (waitlist.jsonl, smart-wallets.json), the server-only worker scripts
  # (watchdog, rpcproxy) that were never committed, and .git — a deploy checkout
  # routinely carries commits that were never pushed anywhere, and it is only a
  # few MB. node_modules/.next are reproducible from the lockfile — excluded.
  run tar czf "$BACKUP" \
    --exclude='node_modules' --exclude='.next' \
    -C "$(dirname "$APP_DIR")" "$(basename "$APP_DIR")"
else
  warn "$APP_DIR does not exist — skipping directory backup."
fi

# The PM2 dump records how watchdog/rpcproxy were started (interpreter, args,
# env). Without it that configuration is unrecoverable.
if [ -f "$HOME/.pm2/dump.pm2" ]; then
  run cp "$HOME/.pm2/dump.pm2" "${BACKUP_DIR}/apewise-pm2-dump-${STAMP}.json"
fi

if [ "$DRY" -eq 0 ] && [ -d "$APP_DIR" ]; then
  [ -s "$BACKUP" ] || { echo "Backup is missing or empty — refusing to delete anything." >&2; exit 1; }
  ok "Backup written: $(du -h "$BACKUP" | cut -f1)  $BACKUP"
fi

# ── 2. Watchdog first, or it undoes everything that follows ──────────────────
if printf '%s\n' "$PROCS" | grep -qx 'apewise-watchdog'; then
  say "Stopping the watchdog first (it restarts the app otherwise)"
  run_soft pm2 delete apewise-watchdog
fi

# ── 3. Remove the remaining apewise-* processes, then persist ────────────────
if [ -n "$PROCS" ]; then
  say "Removing the remaining apewise processes"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if [ "$name" = "apewise-watchdog" ]; then continue; fi
    run_soft pm2 delete "$name"
  done <<< "$PROCS"

  say "Persisting PM2 state (so a reboot cannot resurrect them)"
  run pm2 save
fi

# ── 4. Nginx vhost — otherwise the domain serves a 502 forever ───────────────
if [ "$KEEP_NGINX" -eq 0 ] && command -v nginx >/dev/null 2>&1; then
  say "Nginx vhost (proxying to :${APP_PORT})"
  # The vhost is rarely named after the app, so match on what it *does* — a
  # proxy_pass to this app's port — rather than on its filename.
  VHOSTS="$(grep -RlE "proxy_pass[[:space:]]+https?://(127\.0\.0\.1|localhost|\[::1\]):${APP_PORT}\b" \
    /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | sort -u || true)"
  COUNT="$(printf '%s' "$VHOSTS" | grep -c . || true)"

  if [ "$COUNT" -eq 0 ]; then
    warn "No enabled vhost proxies to :${APP_PORT} — nothing to disable."
  elif [ "$COUNT" -gt 1 ]; then
    printf '%s\n' "$VHOSTS" | sed 's/^/   /'
    warn "More than one vhost proxies to :${APP_PORT}. Too ambiguous to touch —"
    warn "disable the right one by hand, then: nginx -t && systemctl reload nginx"
  else
    echo "   $VHOSTS"
    run cp -L "$VHOSTS" "${BACKUP_DIR}/apewise-vhost-${STAMP}.conf"
    if [ -L "$VHOSTS" ]; then
      # sites-enabled entry: dropping the symlink leaves sites-available intact.
      run rm -f "$VHOSTS"
    else
      # A real file (typically conf.d/*.conf): rename so nginx stops including
      # it, rather than deleting a config we did not write.
      run mv "$VHOSTS" "${VHOSTS}.disabled"
    fi
    if [ "$DRY" -eq 1 ]; then
      printf '   \033[2mwould run:\033[0m nginx -t && systemctl reload nginx\n'
    else
      nginx -t && systemctl reload nginx && ok "Nginx reloaded."
    fi
  fi
fi

# ── 5. Files ─────────────────────────────────────────────────────────────────
if [ "$KEEP_FILES" -eq 1 ]; then
  warn "--keep-files: leaving $APP_DIR on disk."
elif [ -d "$APP_DIR" ]; then
  say "Deleting $APP_DIR"
  case "$APP_DIR" in
    /|/root|/home|/var|/var/www|/usr|/etc)
      echo "Refusing to delete a system directory: $APP_DIR" >&2; exit 1 ;;
  esac
  # Step out of the tree first. Unlinking the process's own cwd leaves every
  # command that follows resolving a dead inode — Node dies outright on it
  # (ENOENT: uv_cwd), so the verification below would take pm2 with it.
  cd /
  run rm -rf "$APP_DIR"
fi

# ── Verify ───────────────────────────────────────────────────────────────────
say "Result"
if [ "$DRY" -eq 1 ]; then
  warn "Dry run finished. Re-run with --yes to apply."
  exit 0
fi

pm2 list
echo
if pm2 jlist 2>/dev/null | grep -q '"name":"apewise'; then
  warn "Some apewise processes are still registered — inspect 'pm2 list' above."
else
  ok "No apewise processes left in PM2."
fi
if command -v ss >/dev/null 2>&1 && ss -ltnp 2>/dev/null | grep -q ':3000'; then
  warn "Something is still listening on :3000."
else
  ok "Port 3000 is free."
fi
[ -d "$APP_DIR" ] && warn "$APP_DIR still exists." || ok "$APP_DIR removed."
echo
ok "Backup kept at: $BACKUP"
case "$INVOKED_FROM" in
  "$APP_DIR"|"$APP_DIR"/*)
    warn "Your shell is still in the directory that was just deleted. Run 'cd ~'"
    warn "before the next command, or pm2/node will fail with ENOENT: uv_cwd." ;;
esac
warn "Loose ends to close outside this server: the Helius webhook still POSTs to"
warn "this host (delete it in the Helius dashboard), and the Telegram/X bot tokens"
warn "in the backup remain valid — revoke them if ApeWise is retired for good."
