/**
 * POST /api/ingest
 *
 * Writes a ticker+candle snapshot into the D1 `live_ticker` table
 * (migrations/0004_live_ticker.sql), read by src/market/provider.js as the
 * last-resort fallback when chart_db and the live exchange chain (Binance /
 * Bybit / OKX) have all failed or returned stale data.
 *
 * NOTE: nothing currently calls this endpoint. It was built for a GitHub
 * Actions cron (pushing every ~5 minutes from GitHub's runner IPs, which
 * aren't affected by exchange WAFs blocking Cloudflare's own IP ranges),
 * but that workflow was never actually implemented/committed. The endpoint
 * and its auth are left in place and ready to use if that cron gets added.
 *
 * Not covered by the cookie login gate (see functions/_middleware.js
 * PUBLIC_PATHS) since a cron has no browser session - it would authenticate
 * with the x-ingest-secret header (env.INGEST_SECRET) instead. Set this
 * secret with `wrangler pages secret put INGEST_SECRET` and put the same
 * value in the GitHub repo's INGEST_SECRET Actions secret if/when a pusher
 * is implemented.
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
