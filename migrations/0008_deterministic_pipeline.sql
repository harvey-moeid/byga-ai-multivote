-- Application DB only. chart_db is never migrated or written by this project.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  candle_key TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_updated ON pipeline_runs(updated_at DESC);
CREATE TABLE IF NOT EXISTS discord_outbox (
  analysis_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT
);
