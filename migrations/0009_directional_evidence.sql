-- Persist verified directional evidence returned by production analyst prompts.
-- Evidence is validated against the deterministic group snapshot before storage.
ALTER TABLE analysis_results ADD COLUMN evidence_json TEXT;
