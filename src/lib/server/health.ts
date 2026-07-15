/**
 * In-process pipeline heartbeat — the single place that answers "is the bot
 * actually posting, and if not, which stage died?". Every stage records its
 * last success/failure here; GET /api/health exposes the snapshot plus a
 * derived verdict, and scripts/watchdog.mjs turns that into operator alerts.
 *
 * Deliberately dependency-free (no relative imports) so any module — including
 * the ones unit-tested under `node --test`, which can't resolve extensionless
 * relative imports — can pull it in statically or dynamically.
 */

export interface ChannelStat {
  ok: number;
  fail: number;
  failStreak: number;
  lastOkAt?: number;
  lastFailAt?: number;
  lastError?: string;
}

export interface HealthSnapshot {
  startedAt: number;
  ingest: {
    /** Last time ANY ingest request was processed (webhook rx or poll cycle). */
    lastRxAt?: number;
    /** Last time a fresh (non-duplicate) event was actually stored. */
    lastEventAt?: number;
    lastSource?: string;
    walletCount?: number;
    rpc: {
      url?: string;
      cycles: number;
      lastCycleAt?: number;
      lastCycleCalls?: number;
      lastCycleFails?: number;
      /** Consecutive poll cycles where EVERY RPC call failed. */
      allFailStreak: number;
    };
  };
  telegram: ChannelStat;
  twitter: ChannelStat & {
    /** X rejected our credentials (401/403) — posting is dead until keys are fixed. */
    authFailed?: boolean;
    /** X monthly usage cap hit — posting is dead until the cap resets. */
    capped?: boolean;
  };
  tweetDispatch: {
    lastRunAt?: number;
    lastPostedAt?: number;
    lastBlocked?: string;
    poolSize?: number;
  };
}

const newChannel = (): ChannelStat => ({ ok: 0, fail: 0, failStreak: 0 });

const health: HealthSnapshot = {
  startedAt: Date.now(),
  ingest: { rpc: { cycles: 0, allFailStreak: 0 } },
  telegram: newChannel(),
  twitter: newChannel(),
  tweetDispatch: {},
};

export function noteIngest(source: string, freshEvents: number): void {
  const now = Date.now();
  health.ingest.lastRxAt = now;
  health.ingest.lastSource = source;
  if (freshEvents > 0) health.ingest.lastEventAt = now;
}

export function noteWalletCount(n: number): void {
  health.ingest.walletCount = n;
}

export function noteRpcCycle(stats: {
  url: string;
  calls: number;
  fails: number;
}): void {
  const r = health.ingest.rpc;
  r.url = stats.url;
  r.cycles++;
  r.lastCycleAt = Date.now();
  r.lastCycleCalls = stats.calls;
  r.lastCycleFails = stats.fails;
  if (stats.calls > 0 && stats.fails >= stats.calls) r.allFailStreak++;
  else if (stats.calls > 0) r.allFailStreak = 0;
}

function noteChannel(ch: ChannelStat, ok: boolean, error?: string): void {
  const now = Date.now();
  if (ok) {
    ch.ok++;
    ch.failStreak = 0;
    ch.lastOkAt = now;
    ch.lastError = undefined;
  } else {
    ch.fail++;
    ch.failStreak++;
    ch.lastFailAt = now;
    if (error) ch.lastError = error.slice(0, 300);
  }
}

export function noteTelegram(ok: boolean, error?: string): void {
  noteChannel(health.telegram, ok, error);
}

export function noteTwitter(
  ok: boolean,
  info?: { error?: string; authFailed?: boolean; capped?: boolean },
): void {
  noteChannel(health.twitter, ok, info?.error);
  if (ok) {
    health.twitter.authFailed = false;
    health.twitter.capped = false;
  } else {
    if (info?.authFailed) health.twitter.authFailed = true;
    if (info?.capped) health.twitter.capped = true;
  }
}

export function noteTweetDispatch(info: {
  posted?: number;
  blocked?: string;
  poolSize?: number;
}): void {
  const d = health.tweetDispatch;
  d.lastRunAt = Date.now();
  d.poolSize = info.poolSize;
  d.lastBlocked = info.blocked;
  if (info.posted) d.lastPostedAt = Date.now();
}

export function getHealth(): HealthSnapshot {
  return health;
}

// ───────────────────────── derived verdict (pure) ─────────────────────────

export interface HealthThresholds {
  /** Minutes without ANY ingest activity before ingestion counts as stalled. */
  ingestStallMin: number;
  /** Minutes without a fresh stored event before flagging (soft — markets idle too). */
  eventStallMin: number;
  /** Consecutive channel failures before the channel counts as failing. */
  channelFailStreak: number;
  /** Consecutive all-fail RPC cycles before the RPC counts as dead. */
  rpcFailStreak: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  ingestStallMin: 30,
  eventStallMin: 360,
  channelFailStreak: 3,
  rpcFailStreak: 5,
};

export interface HealthVerdict {
  status: "ok" | "degraded" | "stalled";
  problems: string[];
}

/**
 * Turn a snapshot into an operator-facing verdict. Pure — unit-testable.
 * "stalled" = posting is (or is about to be) fully dead and needs a human;
 * "degraded" = something is failing but posting may still limp along.
 */
export function deriveVerdict(
  h: HealthSnapshot,
  now: number,
  t: HealthThresholds = DEFAULT_THRESHOLDS,
): HealthVerdict {
  const hard: string[] = [];
  const soft: string[] = [];
  const min = 60_000;

  if (h.ingest.walletCount === 0) {
    hard.push("wallets-empty: tracked-wallet set resolved to 0 wallets — nothing can be detected");
  }

  const lastActivity = Math.max(
    h.ingest.lastRxAt ?? 0,
    h.ingest.rpc.lastCycleAt ?? 0,
  );
  if (lastActivity > 0 && now - lastActivity > t.ingestStallMin * min) {
    hard.push(
      `ingest-stalled: no ingest activity for ${Math.round((now - lastActivity) / min)}m (workers down or webhook dead?)`,
    );
  } else if (lastActivity === 0 && now - h.startedAt > t.ingestStallMin * min) {
    // Not one ingest tick since boot. In RPC-poll mode that means the poll
    // worker isn't running at all; in webhook mode it may just be a quiet
    // market — so this is soft, but it must not read as "ok": a dead worker
    // used to be completely invisible here.
    soft.push(
      `ingest-silent: no ingest tick since boot ${Math.round((now - h.startedAt) / min)}m ago — if you run the RPC poller, it's down (pm2 start scripts/rpc-poll-worker.mjs); in webhook mode verify the webhook (node scripts/doctor.mjs)`,
    );
  }

  if (h.ingest.rpc.allFailStreak >= t.rpcFailStreak) {
    hard.push(
      `rpc-dead: last ${h.ingest.rpc.allFailStreak} poll cycles had every RPC call fail (${h.ingest.rpc.url ?? "?"})`,
    );
  }

  if (h.twitter.authFailed) {
    hard.push("x-auth-failed: X rejected the API keys (401/403) — regenerate tokens with Read+Write");
  }
  if (h.twitter.capped) {
    hard.push("x-usage-capped: X monthly post cap exhausted — posting resumes when the cap resets (or upgrade the tier)");
  }
  if (h.telegram.failStreak >= t.channelFailStreak) {
    hard.push(
      `telegram-failing: ${h.telegram.failStreak} consecutive send failures (${h.telegram.lastError ?? "?"})`,
    );
  }
  if (
    !h.twitter.authFailed &&
    !h.twitter.capped &&
    h.twitter.failStreak >= t.channelFailStreak
  ) {
    soft.push(
      `twitter-failing: ${h.twitter.failStreak} consecutive post failures (${h.twitter.lastError ?? "?"})`,
    );
  }

  const lastEvent = h.ingest.lastEventAt ?? 0;
  if (lastEvent > 0 && now - lastEvent > t.eventStallMin * min) {
    soft.push(
      `events-quiet: no fresh event stored for ${Math.round((now - lastEvent) / min)}m — check wallet set / ingest mode`,
    );
  }

  if (hard.length) return { status: "stalled", problems: [...hard, ...soft] };
  if (soft.length) return { status: "degraded", problems: soft };
  return { status: "ok", problems: [] };
}
