-- AI Multi-Vote BTCUSDT Signal -- dashboard model settings
--
-- Key/value store for settings edited from the dashboard UI. Currently holds
-- one row, key = 'model_overrides': JSON of per-provider model name overrides
-- and enabled=false flags (see src/lib/model-settings.js).
--
-- Previously this table was created lazily on every request from application
-- code. CI applies all migrations before each deploy (see .github/workflows/ci.yml),
-- so the schema now lives here. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
