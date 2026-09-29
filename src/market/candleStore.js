/**
 * D1-backed candle cache — shared by M15 / H1 / H4 / D1 historical context.
 */

const UPSERT_CHUNK = 50; // keep each D1 batch small and reliable

export async function upsertCandles(db, { exchange, symbol, timeframe, candles }) {
  if (!candles?.length) return 0;
  const updatedAt = new Date().toISOString();

  const stmts = candles.map((c) =>
    db
      .prepare(
        `INSERT INTO candles (exchange, symbol, timeframe, timestamp, open, high, low, close, volume, closed, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (exchange, symbol, timeframe, timestamp) DO UPDATE SET
           open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
           volume=excluded.volume, closed=excluded.closed, updated_at=excluded.updated_at`
      )
      .bind(
        exchange,
        symbol,
        timeframe,
        c.timestamp,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        c.closed ? 1 : 0,
        updatedAt
      )
  );

  let written = 0;
  for (let i = 0; i < stmts.length; i += UPSERT_CHUNK) {
    const chunk = stmts.slice(i, i + UPSERT_CHUNK);
    await db.batch(chunk);
    written += chunk.length;
  }
  return written;
}

export async function getCandlesFromD1(db, { exchange, symbol, timeframe, sinceMs }) {
  const { results } = await db
    .prepare(
      `SELECT timestamp, open, high, low, close, volume, closed FROM candles
       WHERE exchange = ? AND symbol = ? AND timeframe = ? AND timestamp >= ?
       ORDER BY timestamp ASC`
    )
    .bind(exchange, symbol, timeframe, sinceMs)
    .all();

  return results.map((r) => ({
    timestamp: r.timestamp,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    closed: !!r.closed,
  }));
}