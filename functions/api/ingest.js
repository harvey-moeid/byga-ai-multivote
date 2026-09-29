/**
 * POST /api/ingest
 *
 * Receives a fresh ticker+candle snapshot pushed by the GitHub Actions
 * cron (.github/workflows/refresh-live-ticker.yml, every ~5 minutes) and
 * writes it into the D1 `live_ticker` table (migrations/0004_live_ticker.sql).
 *
 * src/market/provider.js reads this cached snapshot as a last-resort
 * fallback when a *live* fetch to both Binance and Bybit fails - which in
 * practice usually means both exchanges returned HTTP 403, because their
 * WAFs block Cloudflare's own IP ranges (the ones Pages Functions run
 * from). The cron runs on GitHub's runner IPs instead, which aren't
 * affected by that block. See docs/LIVE_TICKER_CACHE.md.
 *
 * Not covered by the cookie login gate (see functions/_middleware.js
 * PUBLIC_PATHS) since the cron has no browser session - it authenticates
 * with the x-ingest-secret header (env.INGEST_SECRET) instead. Set this
 * secret with `wrangler pages secret put INGEST_SECRET` and put the same
 * value in the GitHub repo's INGEST_SECRET Actions secret.
 */

import { saveLiveSnapshot } from "../../src/market/liveSnapshotStore.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const secret = request.headers.get("x-ingest-secret");
  if (!env.INGEST_SECRET || secret !== env.INGEST_SECRET) {
    return json(401, { error_code: "UNAUTHENTICATED", error: "Missing or invalid x-ingest-secret header." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error_code: "BAD_REQUEST", error: "Invalid JSON body." });
  }

  const { symbol, timeframe, exchange, last_price, price_change_pct_24h, volume_24h, candles } = body || {};
  if (!symbol || !timeframe || !exchange || !Array.isArray(candles) || candles.length === 0) {
    return json(400, {
      error_code: "BAD_REQUEST",
      error: "Body must include symbol, timeframe, exchange, and a non-empty candles array.",
    });
  }

  try {
    await saveLiveSnapshot(env.DB, {
      symbol,
      timeframe,
      exchange,
      last_price: Number(last_price),
      price_change_pct_24h: Number(price_change_pct_24h),
      volume_24h: Number(volume_24h),
      candles,
    });
    return json(200, { ok: true });
  } catch (err) {
    console.error("live_ticker ingest failed", err);
    return json(500, { error_code: "UNKNOWN_ERROR", error: err.message || "Failed to save snapshot." });
  }
}

export async function onRequestGet() {
  return json(405, { error: "Use POST to ingest a snapshot." });
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
