-- Distinguish a normal majority from model NO_TRADE, vote ties, and no valid AI votes.
ALTER TABLE analyses ADD COLUMN decision_reason TEXT NOT NULL DEFAULT 'MAJORITY';
CREATE INDEX IF NOT EXISTS idx_analyses_decision_reason ON analyses (decision_reason);