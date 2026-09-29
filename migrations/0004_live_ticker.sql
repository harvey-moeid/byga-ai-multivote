-- AI Multi-Vote BTCUSDT Signal - live (current-timeframe) ticker cache.
--
-- Populated by the GitHub Actions cron in
-- .github/workflows/refresh-live-ticker.yml (~every 5 minutes) via
-- POST /api/ingest, and read by getMarketSnapshot() in src/market/provider.js
-- as a fallback when a *live* fetch to both Binance and Bybit fails (e.g.
-- both return HTTP 403 because both exchanges' WAFs block Cloudflare's own
-- IP ranges). See docs/LIVE_TICKER_CACHE.md.

CREATE TABLE IF NOT EXISTS live_ticker (
  symbol               TEXT NOT NULL,
  timeframe            TEXT NOT NULL,
  exchange             TEXT NOT NULL,      -- which exchange this snapshot actually came from
  last_price           REAL NOT NULL,
  price_change_pct_24h REAL NOT NULL,
  volume_24h           REAL NOT NULL,
  candles_json         TEXT NOT NULL,      -- JSON array, same shape as binance.js/bybit.js candles
  fetched_at           TEXT NOT NULL,      -- ISO timestamp, when the cron fetched this snapshot
  PRIMARY KEY (symbol, timeframe)
);
