-- AI Multi-Vote BTCUSDT Signal -- login rate limiting (auth extension)
--
-- Backs the brute-force guard on POST /api/login. Tracks consecutive
-- failed password attempts per client IP so a lockout can be applied
-- after too many failures. Session state itself is NOT stored here -
-- sessions are signed cookies (see src/lib/auth.js) and need no DB row.

CREATE TABLE IF NOT EXISTS login_attempts (
  ip            TEXT PRIMARY KEY,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt  TEXT NOT NULL,
  locked_until  TEXT
);
