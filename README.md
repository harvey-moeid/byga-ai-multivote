# AI Multi-Vote BTCUSDT Signal

Implementasi teknis dari **PRD v1.2 Final (AI Worker Revision)**. Aplikasi personal untuk memperoleh second opinion dari **6 model AI** (via satu binding external AI providers) terhadap kondisi **BTCUSDT perpetual M5**, dengan voting BUY/SELL/NO_TRADE dan histori 365 hari.

> Tidak ada eksekusi order otomatis. Hasil AI murni bahan informasi (lihat PRD Bagian 3 & 40).

Aplikasi ini dilindungi oleh **login dengan satu password bersama** (lihat Bagian 4) - seluruh dashboard dan endpoint `/api/*` mengharuskan sesi yang valid (kecuali `/api/ingest`, yang memakai `INGEST_SECRET`).

---

## 1. Arsitektur

```text
User -> [LOGIN] -> session cookie -> [MULAI ANALISIS] -> POST /api/analyze
                                            |
                                  Run guards (cooldown + once-per-candle)
                                            |
                          Market Provider (src/market/provider.js)
            live M5: Binance -> fallback Bybit -> fallback OKX -> fallback snapshot live_ticker (D1, bila terisi)
            history M15/H1/H4/D1: D1 `candles` cache -> backfill dari exchange bila kurang/stale
                                            |
                          Prompt Builder (compact, versioned, indikator server-side)
                                            |
                          6 AI Adapters (Promise.allSettled)
        GPT-OSS 20B | Llama 3.3 70B | DeepSeek R1 Distill 32B
        Qwen3 30B A3B | Mistral Small 3.1 24B | Gemma 4 26B A4B
                                            |
                          Normalizer -> Voting Engine
                                            |
                          D1 (analyses + analysis_results)
                                            |
                          JSON response -> Dashboard
```

Data market memakai **API publik** exchange (tanpa API key). Data M5 live diambil tiap run dan langsung masuk prompt; hanya data histori (M15/H1/H4/D1) yang di-cache di D1.

Semua model dipanggil server-side melalui HTTPS API adapter. API key disimpan sebagai Cloudflare Pages secrets; tidak ada browser automation. Lihat PRD Bagian 4, 10, 11.

Setiap request - halaman dashboard maupun `/api/*` - melewati `functions/_middleware.js` terlebih dahulu, yang menolak apa pun tanpa session cookie yang valid (lihat Bagian 4).

## 2. Struktur Proyek

```text
dashboard/            # Static frontend (vanilla JS SPA, mobile-first)
  index.html app.js login.html login.js styles.css
src/
  orchestrator/        # analysis.js (main flow), voting.js, normalizer.js, select-providers.js
  market/              # provider.js (rantai exchange), binance.js, bybit.js, okx.js, history.js (MTF cache),
                       # candleStore.js (tabel candles), liveSnapshotStore.js (tabel live_ticker)
  prompt/              # builder.js (prompt compact, versioned, indikator + key levels)
  providers/           # 6 AI adapters + shared base.js + registry.js
  lib/                 # id.js, storage.js (D1 access layer), auth.js, loginAttempts.js
functions/
  _middleware.js       # Login gate - dijalankan untuk semua request
  api/
    login.js logout.js # POST /api/login, POST /api/logout
    analyze.js         # POST /api/analyze (+ run guards)
    history.js         # GET  /api/history
    analysis/[id].js   # GET  /api/analysis/:id
    cleanup.js         # POST /api/cleanup (retention)
    ingest.js          # POST /api/ingest (menerima snapshot live, auth INGEST_SECRET; tanpa pemanggil otomatis)
migrations/
  0001_initial.sql               # analyses, analysis_results
  0002_add_login_attempts.sql    # login_attempts (rate limit)
  0003_candles.sql               # cache candle historis MTF
  0004_live_ticker.sql           # snapshot live (fallback saat 403)
.github/workflows/
  ci.yml                         # unit test sebelum deploy Cloudflare Pages
docs/                            # PRD, PROVIDERS.md, SETTINGS.md
tests/                           # vitest (lihat Bagian 5)
wrangler.toml                    # [ai] binding, [[d1_databases]], vars
```

## 3. Setup

### Prasyarat
- Akun Cloudflare dengan **external AI providers** dan **D1** diaktifkan.
- Node.js 18+, `npm i -g wrangler` (atau pakai `npx wrangler`).

### Langkah instalasi

```bash
cd byga-ai-multivote
npm install
```

### 1) Buat database D1 BARU

Database lama tidak digunakan oleh proyek ini. Buat database baru khusus `byga-ai-multivote`:

```bash
npm run db:create
```

Salin `database_id` yang muncul ke `wrangler.toml`, menggantikan `REPLACE_WITH_NEW_D1_DATABASE_ID`.

### 2) Jalankan migration

```bash
npm run db:migrate:local     # untuk dev lokal
npm run db:migrate:remote    # untuk database production di Cloudflare
```

Menjalankan `0001` sampai `0004` (schema analisis, rate limit login, cache candle, snapshot live).

### 3) External AI provider adapter

Proyek ini **tidak menggunakan Cloudflare Workers AI**. Voting memakai HTTPS API dari provider eksternal. API key disimpan sebagai Cloudflare Pages Secrets, bukan di `wrangler.toml`.

Provider yang didukung:
- Google Gemini API
- Groq
- OpenRouter
- Mistral AI
- Hugging Face
- Cohere
- NVIDIA API Catalog
- SambaNova Cloud
- Vercel AI Gateway

Lihat `docs/EXTERNAL_AI_SETUP.md` untuk nama secret dan konfigurasi masing-masing provider.

### 4) Konfigurasi login (wajib)

Lihat Bagian 4 - set `APP_PASSWORD` dan `SESSION_SECRET` sebelum menjalankan `npm run dev` atau deploy, kalau tidak semua request akan ditolak dengan `AUTH_NOT_CONFIGURED`.

### 5) Jalankan lokal

```bash
npm run dev
```

Buka `http://localhost:8788` (default port `wrangler pages dev`). Kamu akan diarahkan ke `/login` dulu.

### 6) Deploy

```bash
npx wrangler pages project create byga-ai-multivote
npm run deploy
```

Setelah deploy pertama, cek di dashboard Cloudflare Pages -> **Settings -> Functions** bahwa binding **D1 (`DB`)** dan **external AI providers (`AI`)** ter-attach, serta secret `APP_PASSWORD` dan `SESSION_SECRET` sudah di-set untuk production.

## 4. Login

Aplikasi ini single-user (PRD Bagian 3), jadi login-nya sengaja sederhana: **satu password bersama**, bukan sistem akun. Diimplementasikan di:

- `functions/_middleware.js` - gerbang global. Berjalan untuk *setiap* request, kecuali `/login`, `/login.html`, `/api/login`, dan `styles.css`. Tanpa session cookie yang valid: halaman di-redirect ke `/login`, `/api/*` dibalas `401`.
- `functions/api/login.js` - cocokkan password terhadap `env.APP_PASSWORD` (constant-time compare), lalu set cookie sesi yang ditandatangani (HMAC-SHA256, `HttpOnly; Secure; SameSite=Strict`, berlaku 30 hari).
- `functions/api/logout.js` - hapus cookie sesi.
- `src/lib/auth.js` - pembuatan/verifikasi token sesi (stateless).
- `src/lib/loginAttempts.js` + tabel `login_attempts` (migration `0002`) - mengunci satu IP selama 15 menit setelah 5 kali gagal berturut-turut.

### Set secret

```bash
npx wrangler pages secret put APP_PASSWORD
npx wrangler pages secret put SESSION_SECRET   # string acak panjang, mis. openssl rand -base64 32
```

(atau `npm run secrets:setup`). Ulangi untuk setiap environment (production/preview) bila perlu.

### Dev lokal

```bash
cp .dev.vars.example .dev.vars
# lalu edit .dev.vars dan isi APP_PASSWORD / SESSION_SECRET
```

`.dev.vars` sudah ada di `.gitignore` - jangan pernah commit password/secret asli.

### Mengganti password

Set ulang `APP_PASSWORD` dengan `wrangler pages secret put APP_PASSWORD`. Sesi yang sudah aktif tetap valid sampai cookie habis atau logout manual. Ganti juga `SESSION_SECRET` untuk memaksa semua sesi lama invalid.

## 5. Testing

```bash
npm test
```

CI (`.github/workflows/ci.yml`) menjalankan test yang sama sebelum deploy. Cakupan:
- `voting.test.js` - majority rule, tie -> NO_TRADE, partial failure, vote share.
- `parser.test.js` - parsing `SIGNAL:`/`REASON:`, fallback loose match, ambiguous tidak dipaksa jadi BUY/SELL.
- `market.test.js` - Binance sukses, gagal -> fallback Bybit, keduanya gagal -> `MarketDataError`.
- `okx.test.js` - pemetaan simbol/timeframe OKX, normalisasi data, dan rantai fallback Binance -> Bybit -> OKX.
- `prompt.test.js` - cap candle per timeframe, encoding compact `[k,o,h,l,c,v]`, ukuran payload, indikator (EMA/RSI/ATR/swing), key levels, definisi horizon dan NO_TRADE, ringkasan sinyal (total saja), versi prompt.
- `analyze-guard.test.js` - cooldown dan once-per-candle di `POST /api/analyze`.
- `auth.test.js` - token sesi (valid, salah secret, expired, tampered), constant-time compare, cookie dari `Request`.
- `adapter.test.js`, `gemma-adapter.test.js`, `qwen-adapter.test.js`, `reasoning-models.test.js`, `select-providers.test.js` - adapter dan pemilihan model.

Provider AI nyata (external AI providers) tidak di-mock karena butuh binding runtime asli - validasi end-to-end lewat POC manual (`npm run dev` lalu klik "Mulai Analisis").

## 6. Menambah model AI ke-7

Sesuai PRD Bagian 39 - tanpa mengubah orchestrator/voting/D1/dashboard core:

1. Buat `src/providers/nama-model.js`, contoh isi lihat `src/providers/gemma3.js`.
2. Export `meta` (provider key, label, model ID external AI providers, adapter version) dan `run({env, prompt, timeoutMs, maxRetries})` yang memanggil `runAdapter()` dari `base.js`.
3. Tambahkan ke array `PROVIDERS` di `src/providers/registry.js`.
4. Tambahkan id, glyph, dan label di `MODEL_ORDER` / `MODEL_GLYPHS` / `MODEL_LABELS` pada `dashboard/app.js`. Id di dashboard harus sama dengan `meta.provider` di backend.

## 7. Scheduled cleanup (opsional)

Retention 365 hari (PRD Bagian 25) dijalankan **opportunistically** setelah setiap `/api/analyze` (lewat `waitUntil`), dan bisa dipicu manual lewat `POST /api/cleanup` (di balik login gate). Pages Functions tidak mendukung Cron Trigger langsung; kalau ingin cleanup harian independen, perlu Worker terpisah dengan `[triggers] crons` yang memanggil endpoint tersebut atau mengakses D1 yang sama.

## 8. Konfigurasi (PRD Bagian 41)

Semua ada di `[vars]` pada `wrangler.toml`: exchange primer/fallback, symbol, timeframe, jumlah candle, versi prompt, timeout AI, max retry, retention, hari histori per timeframe, dan run guard (Bagian 10). `FALLBACK_EXCHANGE` boleh satu nama atau daftar dipisah koma yang dicoba berurutan setelah exchange primer (`binance` | `bybit` | `okx`), contoh `"bybit,okx"`. Model AI dikonfigurasi lewat `src/providers/registry.js`, bukan env var. Kredensial (`APP_PASSWORD`, `SESSION_SECRET`) adalah **secret**, bukan `[vars]`.

## 9. Non-Goals (PRD Bagian 3)

Tidak ada di aplikasi ini, dan sengaja tidak ditambahkan: eksekusi order otomatis, auto trading, copy trading, position management, SL/TP otomatis, leverage management, jaminan akurasi sinyal, layanan multi-user publik (login satu password ini bukan sistem akun).

## 10. Catatan biaya

Setiap analisis menjalankan **satu prompt yang sama ke tiap model aktif**, paralel. Biaya input kira-kira `ukuran prompt x jumlah model`, dan model reasoning (DeepSeek R1 Distill, Qwen3) cenderung lebih lambat/mahal per request (PRD Bagian 11).

Penghemat yang sudah aktif:

- **Prompt compact (sejak v1.8.0):** candle dikirim sebagai baris `[k,o,h,l,c,v]` (bukan object per candle), harga/volume dibulatkan 1 desimal, tanpa flag `closed` dan timestamp panjang.
- **Cap candle kecil:** M5 60, M15 32, H1 48, H4 42, D1 30. Statistik dan indikator tetap dihitung dari seluruh window.
- **Ringkasan sinyal lama = total saja** (`buy_days`, `sell_days`, `no_trade_days`), tanpa breakdown per hari.
- **Run guard di `POST /api/analyze`** (dibandingkan dengan analisis tersimpan terakhir; run yang gagal tidak tersimpan sehingga tidak memblokir):
  - `ANALYZE_COOLDOWN_SECONDS` (default `60`): jeda minimum antar run, `0` untuk mematikan.
  - `ANALYZE_ONCE_PER_CANDLE` (default `1`): tolak run kedua di candle `TIMEFRAME` yang sama karena prompt-nya identik, `0` untuk mematikan. Respons `429` dengan `error_code: COOLDOWN_ACTIVE` dan `retry_after_seconds`.
- **Kurangi model aktif** lewat halaman **Pengaturan** di dashboard (dikirim ke backend sebagai `{ models: [...] }`).

Prompt v1.9.0 menambahkan indikator (EMA20/50, RSI14, ATR14, swing pivot, posisi dalam range, VWAP M5) dan `key_levels` yang dihitung di server, sehingga ukuran prompt naik sekitar 10% dibanding v1.8.0 (sebagian besar dari blok indikator per timeframe).

## 11. Current quality baseline

- Prompt version: **1.11.0** (compact candle encoding + deterministic ICT context + indicators + key levels).
- Horizon sinyal: **1-4 jam ke depan** (12-48 candle M5), dengan kriteria eksplisit BUY/SELL vs NO_TRADE di prompt.
- ICT structure engine: **1.0.0**, server-side BOS/CHOCH/MSS, liquidity sweeps, EQH/EQL, FVG, order blocks, displacement, premium/discount, and M5 session/killzone context.
- Market schema version: **1.4.0**.
- Market routing: **Binance Futures primary -> Bybit Linear fallback -> OKX Swap fallback**.
- Historical context: **M15 4d, H1 30d, H4 180d, D1 365d**, di-cache di D1 (`candles`).
- Raw prompt candle caps: M5 60, M15 32, H1 48, H4 42, D1 30.
- Ringkasan sinyal historis di prompt: total hari BUY/SELL/NO_TRADE saja (window penuh).
- ICT context is computed once server-side and passed identically to all active AI voters; indicators and derivatives remain secondary context.
- Model selection dari Settings dikirim ke backend; minimal satu model harus aktif.
- CI menjalankan unit test sebelum deployment Cloudflare Pages.
- Tidak ada eksekusi order otomatis.

## 12. Validation roadmap

Lapisan riset berikutnya adalah signal outcome tracking dan historical replay/backtesting. Keduanya sengaja dipisah dari voting engine agar pembuatan sinyal bisa dievaluasi tanpa memperkenalkan auto trading.

## External AI providers

Aktif: Google Gemini API, Groq, OpenRouter, Mistral AI, Hugging Face, Cohere, NVIDIA API Catalog, SambaNova Cloud, dan Vercel AI Gateway. Semua key disimpan sebagai secrets. Model dapat diganti melalui `wrangler.toml` tanpa mengubah kode adapter.

### Secrets

```bash
npx wrangler pages secret put GEMINI_API_KEY
npx wrangler pages secret put GROQ_API_KEY
npx wrangler pages secret put OPENROUTER_API_KEY
npx wrangler pages secret put MISTRAL_API_KEY
npx wrangler pages secret put HF_TOKEN
npx wrangler pages secret put COHERE_API_KEY
npx wrangler pages secret put NVIDIA_API_KEY
npx wrangler pages secret put SAMBANOVA_API_KEY
npx wrangler pages secret put AI_GATEWAY_API_KEY
```
