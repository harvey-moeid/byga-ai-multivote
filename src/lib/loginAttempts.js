/**
 * Brute-force guard untuk POST /api/login (lihat README "Login").
 *
 * Desain "pre-charge": setiap percobaan DIHITUNG dulu secara atomik sebelum
 * password diverifikasi. Dengan begitu request paralel tidak bisa menguji
 * lebih dari MAX_ATTEMPTS password per jendela, karena percobaan ke-(MAX+1)
 * ditolak tanpa pernah menyentuh perbandingan password. Versi lama
 * (SELECT lalu UPSERT setelah verifikasi) bisa dilewati dengan request
 * bersamaan dan counter-nya tidak pernah reset setelah lockout habis.
 *
 * Aturan:
 * - Percobaan ke-1..MAX_ATTEMPTS diizinkan.
 * - Percobaan ke-(MAX+1) memicu lockout LOCKOUT_MINUTES dan ditolak.
 * - Selama terkunci, percobaan ditolak dan counter tidak bertambah.
 * - Setelah lockout habis, atau bila percobaan terakhir lebih tua dari
 *   ATTEMPT_WINDOW_MINUTES, counter mulai dari 1 lagi.
 * - Login sukses menghapus baris IP tersebut.
 *
 * Satu `db.batch` (transaksi D1) menjalankan: upsert counter -> pasang lock
 * bila perlu -> baca hasil. Timestamp ISO UTC dibandingkan secara teks.
 */

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const ATTEMPT_WINDOW_MINUTES = 15;

export const UPSERT_SQL = `INSERT INTO login_attempts (ip, attempts, last_attempt, locked_until)
VALUES (?1, 1, ?2, NULL)
ON CONFLICT(ip) DO UPDATE SET
  attempts = CASE
    WHEN locked_until IS NOT NULL AND locked_until > ?2 THEN attempts
    WHEN locked_until IS NOT NULL THEN 1
    WHEN last_attempt <= ?3 THEN 1
    ELSE attempts + 1
  END,
  last_attempt = CASE
    WHEN locked_until IS NOT NULL AND locked_until > ?2 THEN last_attempt
    ELSE ?2
  END,
  locked_until = CASE
    WHEN locked_until IS NOT NULL AND locked_until <= ?2 THEN NULL
    ELSE locked_until
  END`;

export const LOCK_SQL = `UPDATE login_attempts SET locked_until = ?2
WHERE ip = ?1 AND attempts > ?3 AND locked_until IS NULL`;

export const SELECT_SQL = "SELECT attempts, locked_until FROM login_attempts WHERE ip = ?1";

/**
 * Hitung satu percobaan login untuk `ip` dan putuskan boleh lanjut atau tidak.
 * @returns {Promise<{allowed: boolean, attempts: number, maxAttempts: number, lockedUntil: string|null}>}
 */
export async function registerAttempt(db, ip, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const windowStartIso = new Date(now - ATTEMPT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const lockUntilIso = new Date(now + LOCKOUT_MINUTES * 60 * 1000).toISOString();

  const results = await db.batch([
    db.prepare(UPSERT_SQL).bind(ip, nowIso, windowStartIso),
    db.prepare(LOCK_SQL).bind(ip, lockUntilIso, MAX_ATTEMPTS),
    db.prepare(SELECT_SQL).bind(ip)
  ]);

  const row = results?.[2]?.results?.[0];
  const attempts = Number(row?.attempts ?? 0);
  const allowed = attempts >= 1 && attempts <= MAX_ATTEMPTS;
  return {
    allowed,
    attempts,
    maxAttempts: MAX_ATTEMPTS,
    lockedUntil: allowed ? null : (row?.locked_until ?? lockUntilIso)
  };
}

export async function recordSuccess(db, ip) {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?1").bind(ip).run();
}
