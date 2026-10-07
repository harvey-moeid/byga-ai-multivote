-- Application DB only. Records each primary/fallback provider attempt per character.
-- chart_db remains read-only and is never touched by this migration.
CREATE TABLE IF NOT EXISTS provider_attempts (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  result_id TEXT NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
  analyst_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_label TEXT NOT NULL,
  model TEXT NOT NULL,
  attempt_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_attempts_analysis ON provider_attempts (analysis_id);
CREATE INDEX IF NOT EXISTS idx_provider_attempts_result ON provider_attempts (result_id);
CREATE INDEX IF NOT EXISTS idx_provider_attempts_provider_created ON provider_attempts (provider, created_at DESC);
