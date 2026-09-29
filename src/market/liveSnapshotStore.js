/**
 * D1 cache for the current-timeframe ticker+candle snapshot.
 *
 * Populated by the GitHub Actions cron (.github/workflows/refresh-live-ticker.yml)
 * via POST /api/ingest (functions/api/ingest.js), and read here as a
 * fallback when a live fetch to both Binance and Bybit fails (e.g. HTTP 403
 * from Cloudflare's own IP ranges). See docs/LIVE_TICKER_CACHE.md.
 */

export async function saveLiveSnapshot(
  db,
  { symbol, timeframe, exchange, last_price, price_change_pct_24h, volume_24h, candles }
) {
  const fetchedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO live_ticker (symbol, timeframe, exchange, last_price, price_change_pct_24h, volume_24h, candles_json, fetched_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (symbol, timeframe) DO UPDATE SET
         exchange=excluded.exchange, last_price=excluded.last_price,
         price_change_pct_24h=excluded.price_change_pct_24h, volume_24h=excluded.volume_24h,
         candles_json=excluded.candles_json, fetched_at=excluded.fetched_at`
    )
    .bind(symbol, timeframe, exchange, last_price, price_change_pct_24h, volume_24h, JSON.stringify(candles), fetchedAt)
    .run();
}

export async function getLiveSnapshot(db, { symbol, timeframe }) {
  const row = await db
    .prepare(`SELECT * FROM live_ticker WHERE symbol = ? AND timeframe = ?`)
    .bind(symbol, timeframe)
    .first();
  if (!row) return null;

  return {
    symbol: row.symbol,
    timeframe: row.timeframe,
    exchange: row.exchange,
    last_price: row.last_price,
    price_change_pct_24h: row.price_change_pct_24h,
    volume_24h: row.volume_24h,
    candles: JSON.parse(row.candles_json),
    fetched_at: row.fetched_at,
  };
}
