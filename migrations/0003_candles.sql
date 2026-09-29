-- AI Multi-Vote BTCUSDT Signal - multi-timeframe candle cache (M15 / H1 / H4 / D1)

CREATE TABLE IF NOT EXISTS candles (
  exchange    TEXT NOT NULL,          -- binance | bybit
  symbol      TEXT NOT NULL,
  timeframe   TEXT NOT NULL,          -- 15m | 1h | 4h | 1d
  timestamp   INTEGER NOT NULL,       -- candle open time, ms epoch
  open        REAL NOT NULL,
  high        REAL NOT NULL,
  low         REAL NOT NULL,
  close       REAL NOT NULL,
  volume      REAL NOT NULL,
  closed      INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (exchange, symbol, timeframe, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles (exchange, symbol, timeframe, timestamp DESC);
