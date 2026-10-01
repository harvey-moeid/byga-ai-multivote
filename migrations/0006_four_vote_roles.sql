-- Two AI analysts (AI_A / AI_B), two independent votes each.
ALTER TABLE analysis_results ADD COLUMN role TEXT NOT NULL DEFAULT 'AI_A';
ALTER TABLE analysis_results ADD COLUMN vote_index INTEGER NOT NULL DEFAULT 1;
ALTER TABLE analysis_results ADD COLUMN vote_group TEXT NOT NULL DEFAULT 'AI_A_1';
ALTER TABLE analysis_results ADD COLUMN data_source TEXT NOT NULL DEFAULT 'chart_db';

CREATE INDEX IF NOT EXISTS idx_analysis_results_role_vote ON analysis_results (analysis_id, role, vote_index);
