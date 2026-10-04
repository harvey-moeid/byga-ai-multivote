# BYGA Trading Office

Kantor trading 3D untuk BTCUSDT.P dengan perhitungan deterministik multi-timeframe,
enam karakter analis AI, cron lima menit, dan notifikasi Discord bersyarat.

## Alur produksi

1. Baca candle **tertutup** H1, M15, M5 dari binding D1 `CHART_DB` (`chart_db`).
   Simbol tampilan `BTCUSDT.P` dipetakan ke simbol penyimpanan `BTCUSDT` perpetual.
   Modul `src/pipeline/chart.js` hanya menjalankan **SELECT**. Tidak ada fallback
   ke API exchange, ingest, backfill, atau penulisan ke chart_db dalam alur ini.
2. Hitung tiga snapshot tanpa AI: SMC/ICT, indikator, volume.
   Browser menjalankan `calculateSnapshot`; Pages dan cron memakai modul murni
   yang sama dan menghitung ulang di server agar hasil klien tidak dipercaya begitu saja.
3. Masing-masing kelompok menggabungkan H1 (tren), M15 (struktur), M5 (pemicu).
   Arah tren dan pemicu harus sama, sedangkan struktur boleh NETRAL atau searah.
   Hasil kelompok adalah BUY, SELL, atau NETRAL.
4. Jika minimal **dua dari tiga kelompok** sepakat BUY atau SELL, panggil enam analis:
   dua menerima hanya snapshot SMC/ICT, dua indikator, dua volume. Setiap karakter
   menghasilkan satu vote BUY/SELL. Error/timeout/NO_TRADE tidak dihitung sebagai vote.
5. Jika minimal **empat dari enam** vote valid mendukung **arah awal** perhitungan,
   keputusan disetujui. Empat vote berlawanan arah awal tetap ditolak.
6. Hanya keputusan yang disetujui masuk antrean Discord. Pengiriman membutuhkan
   toggle Discord aktif dan webhook terkonfigurasi. Hasil lainnya tetap di histori.

Enam karakter dan bos berjalan, duduk, berdiskusi dengan gelembung vote/alasan,
lalu kembali ke meja. Dua staf pendukung tetap di meja. Bos memimpin tanpa vote
tambahan. UI yang terbuka memantau hasil cron dan menampilkan meeting baru;
ketika web ditutup, analisis dan pengiriman tetap berjalan di server.

## Perhitungan dan parameter

Atur melalui tombol **Setting**; seluruh parameter disimpan di DB aplikasi dan
dipakai bersama oleh browser, manual, dan cron pada candle berikutnya.

| Kelompok | Aturan/ukuran | Default utama |
| --- | --- | --- |
| SMC/ICT | Pivot terkonfirmasi, BOS/CHOCH, liquidity sweep dua arah, FVG aktif, displacement, order block, dealing range premium/discount | Radius pivot 3, range 80, event 20, ATR 14, displacement 1× ATR, minimum FVG 0.05× ATR, minimum 2 konfirmasi |
| Indikator | EMA, RSI Wilder, MACD, Bollinger Bands, ADX/DI Wilder | EMA 20/50, RSI 14 dengan batas 55/45, MACD 12/26/9, BB 20/2, ADX 14 ≥20, minimum 3 konfirmasi |
| Volume | Relative volume terhadap candle sebelumnya, CMF, perubahan OBV, arah badan candle | Periode 20, RVOL ≥1.2, CMF absolut ≥0.05, jendela OBV 10 |

Default 250 candle per timeframe. Pengaturan divalidasi agar periode, ambang,
urutan timeframe, dan jumlah candle masuk akal. Timeframe tersedia M5, M15, H1,
H4, D1; tren harus lebih besar dari struktur dan struktur lebih besar dari pemicu.

Pivot baru tersedia setelah candle di sisi kanan tertutup; tidak memakai data
masa depan. FVG yang sudah penuh terisi dan order block yang invalid dinonaktifkan.
SMC/ICT di sini adalah definisi algoritmik yang dapat diatur, bukan semua varian
interpretasi diskresioner ICT. CMF/OBV merupakan proksi OHLCV, **bukan** delta
transaksi atau order-flow asli. Data stale, candle kurang, OHLC rusak, celah waktu,
atau sumber perpetual tidak dikenal menghentikan pemrosesan sebelum AI.

chart_db memiliki data Bybit, Binance Futures, serta OKX Swap. Volume OKX memakai
kontrak; volume Bybit/Binance memakai BTC. Kelompok volume hanya memakai rangkaian
terakhir dari sumber yang sama. Bila belum cukup, hasilnya NETRAL; satuan tidak
dicampur dan ditampilkan dalam snapshot. Harga berasal dari candle yang tersedia
di chart_db; metadata sumber dicatat.

## Enam karakter AI

Setiap slot memiliki nama, provider, dan model sendiri. Provider yang sama boleh
dipakai di semua slot, termasuk dengan model berbeda. Model override diisolasi
per panggilan; tidak ada persyaratan enam provider unik.

Provider: Gemini, Groq, OpenRouter, Mistral, Hugging Face, Cohere, NVIDIA,
SambaNova, Vercel AI Gateway, dan **Cloudflare Workers AI**.

Workers AI memakai binding `AI`, tanpa API key tersendiri. Default model
`@cf/meta/llama-3.1-8b-instruct-fast`. Provider eksternal memakai secret berikut
pada **Pages**, sesuai pilihan karakter:

| Provider | Secret |
| --- | --- |
| Gemini | GEMINI_API_KEY |
| Groq | GROQ_API_KEY |
| OpenRouter | OPENROUTER_API_KEY |
| Mistral | MISTRAL_API_KEY |
| Hugging Face | HF_TOKEN |
| Cohere | COHERE_API_KEY |
| NVIDIA | NVIDIA_API_KEY |
| SambaNova | SAMBANOVA_API_KEY |
| Vercel Gateway | AI_GATEWAY_API_KEY |

Default karakter diambil dari provider yang tersedia; Workers AI menjadi pilihan
ketika provider eksternal tidak tersedia. Provider/model bisa diganti dari web.
`/api/models` adalah pengaturan default provider lama; alur baru memakai
`/api/settings` dengan model per karakter.

## Discord dan keamanan

Masukkan URL webhook pada **Setting → Cron dan Discord**. Field ini write only:
nilai disimpan AES-GCM terenkripsi memakai SESSION_SECRET, dan GET tidak pernah
mengembalikan URL/token. Kosongkan field untuk mempertahankan webhook yang ada.
Rotasi SESSION_SECRET memerlukan pengisian ulang webhook yang terenkripsi.
Alternatif: secret Pages `DISCORD_WEBHOOK_URL`, yang mengambil prioritas atas nilai
web. Checkbox hapus hanya menghapus nilai yang disimpan melalui web.

Tujuan webhook dibatasi HTTPS `discord.com`/`discordapp.com`; redirect ditolak.
Mention dinonaktifkan. Outbox dibuat atomik bersama analisis dan enam hasil vote.
Pengiriman yang sudah diakui Discord tidak diulang, dan retry tidak memanggil AI
lagi. HTTP 429/5xx atau kegagalan jaringan dicoba ulang oleh pemeriksaan berikutnya;
4xx permanen ditandai gagal. Sinyal tertunda **kedaluwarsa setelah 15 menit** agar
webhook yang baru dipasang tidak menerima tumpukan sinyal lama.
Seperti webhook HTTP umumnya, bila Discord menerima pesan tetapi respons hilang,
retry jaringan dapat menghasilkan pesan ganda; ID analisis disertakan di pesan.

APP_PASSWORD dan SESSION_SECRET wajib untuk login. Scheduler memakai HMAC
domain khusus atas timestamp dan body, berlaku dua menit. `/api/cron` tidak
membutuhkan sesi browser, tetapi selalu memverifikasi signature. Endpoint lain
tetap dilindungi login. Secret provider/webhook tidak dikirim ke browser atau log.

## Cron dan penyimpanan

Pages tidak memiliki Cron Trigger langsung. Worker `byga-multivote-scheduler`
(`wrangler.scheduler.toml`) menjalankan `*/5 * * * *` dan memanggil `/api/cron`
Pages yang ditandatangani. Scheduler hanya memerlukan SESSION_SECRET dan APP_URL;
tidak perlu menyalin API key provider atau mengakses chart_db.

Lock unik per simbol/timeframe/candle pemicu mencegah manual dan cron memanggil
AI dua kali. Candle yang sudah selesai tetap tidak diproses ulang setelah setting
diubah. Run yang ditinggalkan dapat dipulihkan setelah lease sepuluh menit.
DB aplikasi menyimpan konfigurasi, snapshot ukuran terhitung, hasil vote, run, dan
outbox. Raw window candle tidak disalin seluruhnya ke DB aplikasi.
Histori lama tetap tersedia. Run baru memiliki retensi default 30 hari melalui
cron; ubah `PIPELINE_RETENTION_DAYS` (1–365) bila diperlukan. chart_db tidak dibersihkan.

## Build dan deploy

Node.js **22+**. GitHub CI menjalankan unit test, build bundle lokal, dan tes
Playwright desktop/mobile sebelum deploy.

```sh
npm ci
npm test
npm run build
npm run preview
```

Preview visual lokal: http://localhost:4173, tanpa API produksi. Verifikasi browser:

```sh
npx playwright install --with-deps chromium
npm run test:office
```

GitHub Actions membutuhkan secret `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`APP_PASSWORD`, `SESSION_SECRET`. Token perlu izin Pages, D1 aplikasi, dan Workers
Scripts/cron untuk deploy scheduler. CI menerapkan migrasi **DB aplikasi saja**,
deploy Pages termasuk binding CHART_DB/AI, deploy scheduler, lalu menyamakan signing
secret. Cron Trigger baru dapat membutuhkan beberapa menit untuk propagasi.

Deploy manual:

```sh
npx wrangler pages deploy dashboard --project-name=byga-ai-multivote
npx wrangler deploy --config wrangler.scheduler.toml
npx wrangler secret put SESSION_SECRET --config wrangler.scheduler.toml
```

Binding aplikasi: `DB` → byga-ai-multivote-db, `CHART_DB` → chart_db, `AI` → Workers AI.
Cloudflare D1 binding tidak menawarkan flag read only per database; jaminan aplikasi
diberikan melalui adapter SELECT-only dan pengujian yang menolak operasi tulis.

## API

| Endpoint | Fungsi |
| --- | --- |
| GET /api/market | Candle tervalidasi dan parameter untuk perhitungan browser tanpa AI |
| GET/PUT /api/settings | Parameter, enam karakter, toggle cron/Discord, status webhook |
| POST /api/analyze | Hitung ulang server, validasi candle preview, gate, enam vote, outbox |
| GET /api/status | Run terbaru dan jumlah antrean Discord untuk pemantauan UI |
| GET /api/history | Histori baru serta legacy, termasuk pemeriksaan tersaring |
| GET /api/analysis/:id | Snapshot kelompok dan hasil vote lengkap |
| POST /api/cron | Jalur scheduler dengan HMAC; bukan endpoint publik untuk memicu AI |

Status run: `filtered` (tanpa AI), `approved` (≥4/6 searah), `rejected` (dukungan
kurang), `running`, atau `failed`. NETRAL hanya untuk gate deterministik; vote AI
tetap BUY/SELL. Kolom legacy `majority_signal` menyimpan NO_TRADE ketika belum ada
keputusan disetujui; API baru menampilkan keputusan tersebut sebagai null, dengan
status dan alasan eksplisit.

Kualitas grafis Auto/50%/75%/100% tetap tersedia dan tersimpan pada perangkat.
Gerakan berjalan dipertahankan; pengujian screenshot memakai pause tab latar
belakang lalu melanjutkan pose yang sama. Kinerja pada HP fisik belum diukur.
Tidak ada eksekusi order trading otomatis.
