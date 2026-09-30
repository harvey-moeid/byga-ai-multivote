/**
 * Brute-force guard for POST /api/login (see README "Login").
 * Tracks consecutive failed password attempts per client IP in the
 * `login_attempts` table (migration 0002) and locks an IP out for
 * LOCKOUT_MINUTES after MAX_ATTEMPTS consecutive failures.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function checkLockout(db, ip) {
  const row = await db
    .prepare("SELECT locked_until FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first();

  if (!row?.locked_until) return { locked: false };

  const lockedUntil = new Date(row.locked_until);
  if (Number.isNaN(lockedUntil.getTime()) || lockedUntil.getTime() <= Date.now()) {
    return { locked: false };
  }

  return { locked: true, lockedUntil: row.locked_until };
}

export async function recordFailure(db, ip) {
  const now = new Date();
  const row = await db
    .prepare("SELECT attempts FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first();

  const attempts = (row?.attempts ?? 0) + 1;
  const lockedUntil =
    attempts >= MAX_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : null;

  await db
    .prepare(
      `INSERT INTO login_attempts (ip, attempts, last_attempt, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         attempts = excluded.attempts,
         last_attempt = excluded.last_attempt,
         locked_until = excluded.locked_until`
    )
    .bind(ip, attempts, now.toISOString(), lockedUntil)
    .run();

  return { attempts, maxAttempts: MAX_ATTEMPTS };
}

export async function recordSuccess(db, ip) {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}
