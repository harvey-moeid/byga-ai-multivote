-- AI Multi-Vote BTCUSDT Signal — initial schema (PRD v1.2, Section 24)

CREATE TABLE IF NOT EXISTS analyses (
  id                      TEXT PRIMARY KEY,        -- e.g. ANL-20260923-010201-8F32
  created_at              TEXT NOT NULL,            -- ISO timestamp
  exchange                TEXT NOT NULL,            -- binance | bybit
  symbol                  TEXT NOT NULL,
  market_type             TEXT NOT NULL,
  timeframe               TEXT NOT NULL,
  market_snapshot         TEXT NOT NULL,            -- JSON blob, exact snapshot sent to AI
  prompt_version          TEXT NOT NULL,
  market_schema_version   TEXT NOT NULL,
  majority_signal         TEXT NOT NULL,            -- BUY | SELL | NO_TRADE
  buy_votes               INTEGER NOT NULL DEFAULT 0,
  sell_votes              INTEGER NOT NULL DEFAULT 0,
  no_trade_votes          INTEGER NOT NULL DEFAULT 0,
  success_count           INTEGER NOT NULL DEFAULT 0,
  error_count             INTEGER NOT NULL DEFAULT 0,
  total_models            INTEGER NOT NULL DEFAULT 0,
  duration_ms             INTEGER NOT NULL DEFAULT 0,
  last_price              REAL,
  price_change_pct_24h    REAL
);

CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses (created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_results (
  id                TEXT PRIMARY KEY,               -- uuid
  analysis_id       TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,                  -- e.g. gpt-oss-120b
  provider_label    TEXT NOT NULL,                  -- e.g. GPT-OSS 120B
  status            TEXT NOT NULL,                  -- success | timeout | error
  signal            TEXT,                           -- BUY | SELL | NO_TRADE | ERROR
  reason            TEXT,
  raw_answer        TEXT,
  confidence        REAL,                           -- nullable, only if model provides it
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  error_code        TEXT,                           -- see error code list (Section 19)
  error             TEXT,
  adapter_version   TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_results_analysis_id ON analysis_results (analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_provider ON analysis_results (provider);