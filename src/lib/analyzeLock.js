/**
 * Lock terdistribusi untuk POST /api/analyze.
 *
 * Masalah yang diselesaikan: run guard lama (cooldown / once-per-candle)
 * membandingkan dengan analisis terakhir yang sudah TERSIMPAN. Satu run bisa
 * 60-120 detik, jadi dua request bersamaan sama-sama lolos guard dan masing-
 * masing menghabiskan 12 call AI. Lock ini memastikan hanya satu run aktif.
 *
 * Implementasi: satu baris di tabel `app_settings` (migration 0005), key
 * `analyze_lock`, value = waktu kedaluwarsa lock (ISO UTC, bisa dibandingkan
 * secara leksikografis). Acquire = satu statement UPSERT atomik yang hanya
 * menimpa baris bila lock lama sudah kedaluwarsa; `meta.changes` menunjukkan
 * berhasil (1) atau tidak (0). TTL membuat lock yatim (crash / timeout
 * platform) hilang sendiri.
 *
 * Fail-open: lock hanyalah pengaman biaya, bukan syarat kebenaran. Kalau DB
 * tidak tersedia atau error, analisis tetap jalan tanpa lock (dengan warning).
 */

const LOCK_KEY = "analyze_lock";

const ACQUIRE_SQL = `INSERT INTO app_settings (key, value, updated_at)
VALUES (?1, ?2, ?3)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
WHERE app_settings.value <= ?3`;

const noopLock = () => ({ acquired: true, retryAfterSeconds: 0, release: async () => {} });

/**
 * @param {D1Database} db
 * @param {{ ttlSeconds?: number, now?: number }} [opts]
 * @returns {Promise<{acquired: boolean, retryAfterSeconds: number, release: () => Promise<void>}>}
 */
export async function acquireAnalyzeLock(db, { ttlSeconds = 180, now = Date.now() } = {}) {
  if (!db?.prepare) return noopLock();

  const nowIso = new Date(now).toISOString();
  const expiry = new Date(now + Math.max(1, ttlSeconds) * 1000).toISOString();

  try {
    const res = await db.prepare(ACQUIRE_SQL).bind(LOCK_KEY, expiry, nowIso).run();
    const changes = res?.meta?.changes;
    if (typeof changes !== "number") {
      console.warn("analyze lock: D1 tidak mengembalikan meta.changes, lanjut tanpa lock");
      return noopLock();
    }

    if (changes < 1) {
      const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?1").bind(LOCK_KEY).first();
      const heldUntil = Date.parse(row?.value ?? "");
      const waitMs = Number.isFinite(heldUntil) ? heldUntil - now : ttlSeconds * 1000;
      return { acquired: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)), release: async () => {} };
    }

    return {
      acquired: true,
      retryAfterSeconds: 0,
      // Hanya hapus lock milik kita sendiri (value cocok), jangan lock run lain
      // yang mengambil alih setelah TTL kita habis.
      release: async () => {
        try {
          await db.prepare("DELETE FROM app_settings WHERE key = ?1 AND value = ?2").bind(LOCK_KEY, expiry).run();
        } catch (err) {
          console.warn("analyze lock: gagal melepas lock (akan kedaluwarsa sendiri):", err?.message || err);
        }
      }
    };
  } catch (err) {
    console.warn("analyze lock tidak tersedia, lanjut tanpa lock:", err?.message || err);
    return noopLock();
  }
}
