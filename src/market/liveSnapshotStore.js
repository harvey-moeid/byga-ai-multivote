/**
 * D1 cache for the current-timeframe ticker+candle snapshot.
 *
 * Written via POST /api/ingest (functions/api/ingest.js). NOTE: as of now,
 * nothing actually calls that endpoint — the GitHub Actions cron that was
 * meant to push snapshots here on a schedule was never implemented, so this
 * table stays empty and getLiveSnapshot() below never returns a row. The
 * read path is kept as the last-resort fallback in src/market/provider.js
 * (after chart_db and the live exchange chain both fail) in case a pusher
 * is added later — see that file for the current fallback order.
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
