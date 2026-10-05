# BYGA Trading Office

Kantor trading 3D untuk BTCUSDT.P dengan perhitungan deterministik multi-timeframe,
enam karakter analis AI, cron lima menit, dan notifikasi Discord bersyarat.

## Alur produksi

1. Baca candle **tertutup** dari binding D1 `CHART_DB` (`chart_db`) sesuai tiga
   timeframe yang dipilih untuk tren, struktur, dan pemicu. Simbol tampilan
   `BTCUSDT.P` dipetakan ke `BTCUSDT` perpetual. Adapter market hanya menjalankan
   **SELECT**; tidak ada ingest, fallback exchange, atau penulisan ke chart_db.
2. Hitung tiga snapshot **tanpa AI**: SMC/ICT, indikator, dan volume. Browser dan
   server memakai `calculateSnapshot` yang sama; server selalu menghitung ulang
   sehingga snapshot dari browser tidak dipercaya sebagai sumber keputusan.
3. Masing-masing kelompok menggabungkan timeframe tren/struktur/pemicu. Arah tren
   dan pemicu harus sama, sedangkan struktur boleh NETRAL atau searah. Hasil setiap
   kelompok adalah BUY, SELL, atau NETRAL.
4. Engine mengklasifikasikan **market regime** secara deterministik dari timeframe
   tren: TREND_UP, TREND_DOWN, EXPANSION_UP, EXPANSION_DOWN, COMPRESSION, RANGE,
   atau UNKNOWN. Regime memakai EMA/DI, ADX, ATR relatif, dan return 20 candle.
5. **AUTO / cron:** enam AI hanya dipanggil jika minimal **2 dari 3 kelompok**
   deterministik sepakat BUY atau SELL. Jika gate gagal, run disimpan sebagai
   `filtered` tanpa biaya AI.
6. **MANUAL:** tombol **Mulai Analisis** selalu memanggil keenam AI setelah snapshot
   tervalidasi, walaupun gate 2/3 tidak lolos. Manual boleh dijalankan berulang pada
   candle yang sama, misalnya setelah mengganti provider/model atau parameter.
7. Keenam AI tetap independen: dua hanya menerima SMC/ICT, dua hanya indikator,
   dan dua hanya volume. Dalam setiap pasangan, slot 1 memakai lens **base-case** dan
   slot 2 **adversarial/invalidation-first** untuk mengurangi correlated error.
   Prompt **tidak pernah mengirim arah gate/initial_direction**. AI menerima regime,
   peran timeframe, prioritas keputusan, review lens, dan snapshot kelompoknya
   saja. SMC/ICT dikompakkan ke event terbaru yang relevan agar token tidak terbuang.
   Output wajib BUY/SELL + confidence 0–100 + alasan maksimal dua kalimat.
8. Vote memakai **adaptive weighted voting**. Reliability diukur dari hasil historis
   slot+provider terhadap harga chart_db sekitar 2 jam setelah vote. Jika tersedia
   minimal 12 sampel pada regime yang sama, sampel regime diprioritaskan; jika belum,
   dipakai histori slot+provider pada konfigurasi timeframe yang sama. Accuracy
   di-shrink ke prior 50% (20 sampel prior) dan bobot dibatasi **0.8–1.2**. Jika data
   histori belum cukup atau gagal dibaca, bobot aman kembali ke **1.0**.
   Confidence model hanya menjadi modifier kecil **0.9–1.1**, sehingga satu model
   tidak dapat mendominasi hanya karena mengaku sangat yakin.
9. Keputusan AI dianggap decisive bila ada minimal **4 vote sukses**, minimal
   **3 vote mentah** pada arah pemenang, dan weighted share minimal **60%**.
   Untuk run yang memiliki gate deterministik, arah weighted AI **harus sama**
   dengan arah deterministic agar status menjadi `approved`.
10. Manual tanpa konsensus deterministic tetap menghasilkan analisis:
    `manual_review` bila weighted AI decisive, atau `manual_inconclusive` bila
    belum decisive. Hasil manual tanpa gate **tidak dikirim ke Discord** dan tidak
    dianggap sinyal otomatis.
11. Discord hanya menerima keputusan yang benar-benar `approved`: gate deterministik
    lolos dan weighted AI mengonfirmasi arah tersebut. Payload mencantumkan regime,
    weighted share, raw BUY/SELL, confidence per analis, harga, dan ID analisis.

Enam karakter dan bos berjalan, duduk, berdiskusi dengan gelembung vote/alasan,
lalu kembali ke meja. Dua staf pendukung tetap di meja. Bos memimpin tanpa vote
tambahan. UI yang terbuka memantau hasil cron dan menampilkan meeting baru;
ketika web ditutup, analisis dan pengiriman tetap berjalan di server.

**Prompt produksi v3 berada di `src/pipeline/run.js`.** File
`src/prompt/builder.js` adalah jalur legacy dan tidak dipakai oleh manual/cron
produksi saat ini.

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

### Provider Health

Menu **Setting → Provider Health** menampilkan status operasional tiap provider tanpa
melakukan ping AI tambahan. Health dihitung dari maksimal **12 panggilan terbaru**
yang memang terjadi pada analisis nyata:

- **Healthy**: panggilan terbaru sukses dan success rate ≥80%.
- **Degraded**: provider masih bekerja tetapi recent error/timeout mulai terlihat.
- **Down**: tiga kegagalan beruntun, atau success rate <50% dengan minimal 4 sampel.
- **Ready**: secret/binding tersedia tetapi belum ada histori panggilan.
- **Not configured**: secret/binding provider belum tersedia.

UI juga menampilkan jumlah sampel, success rate, latency rata-rata panggilan sukses,
waktu penggunaan terakhir dalam WIB, dan error code terakhir. Pesan error mentah,
API key, token, dan secret tidak pernah dikirim ke browser. Dropdown provider pada
setiap analis ikut menampilkan status health terbaru.

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

Lock unik per simbol/timeframe/candle pemicu berlaku untuk **AUTO/cron** agar satu
candle tidak memanggil AI otomatis dua kali. **Manual memakai run key unik**, sehingga
analisis manual boleh diulang pada candle yang sama dan tidak diblokir oleh run cron.
Run cron yang ditinggalkan dapat dipulihkan setelah lease sepuluh menit.
DB aplikasi menyimpan konfigurasi, snapshot ukuran terhitung, hasil vote, run, dan
outbox. Raw window candle tidak disalin seluruhnya ke DB aplikasi.
Histori lama tetap tersedia. Run baru memiliki retensi default 30 hari melalui
cron; ubah `PIPELINE_RETENTION_DAYS` (1–365) bila diperlukan. chart_db tidak dibersihkan.

## PWA dan Adaptive 3D

Web dapat di-install sebagai **PWA** melalui browser yang mendukung. Manifest,
ikon 192/512, service worker, dan tombol install disertakan. Asset UI dan bundle
3D dicache agar pembukaan berikutnya lebih cepat dan tetap memiliki shell dasar
ketika koneksi putus. Request `/api/*` **tidak pernah dicache** oleh service
worker, sehingga data analisis, autentikasi, dan hasil trading tetap berasal dari
server.

Mode kualitas sekarang: **Auto / Hemat / Seimbang / Tinggi / Ultra**. Auto memilih
tier awal dari lebar layar, device memory, jumlah core, DPR, dan Data Saver, lalu
menyesuaikan resolution scale secara bertahap berdasarkan frame budget. Bila
perangkat mulai berat, render scale diturunkan lebih dulu sebelum turun tier;
bila stabil beberapa window, scale/tier dinaikkan lagi. Mode Ultra membuka DPR
lebih tinggi dan shadow map lebih besar untuk perangkat yang kuat. Pilihan manual
tetap disimpan di perangkat.

Render loop berhenti efektif saat tab/background tidak aktif, WebGL memakai
`powerPreference: high-performance`, furnitur statis tetap dibatch, lampu dan
shadow disesuaikan per tier, dan bundle 3D dipreload untuk mempercepat first paint.

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
| GET/PUT /api/settings | Parameter, enam karakter, Provider Health, toggle cron/Discord, status webhook |
| POST /api/analyze | Analisis manual: hitung ulang server, validasi preview, selalu panggil 6 AI, weighted vote; Discord hanya jika gate deterministic juga lolos |
| GET /api/status | Run terbaru dan jumlah antrean Discord untuk pemantauan UI |
| GET /api/history | Histori baru serta legacy, termasuk pemeriksaan tersaring |
| GET /api/analysis/:id | Snapshot kelompok dan hasil vote lengkap |
| POST /api/cron | Jalur scheduler dengan HMAC; bukan endpoint publik untuk memicu AI |

Status run: `filtered` (AUTO gagal gate, tanpa AI), `approved` (weighted AI
mengonfirmasi arah deterministic), `rejected` (AI tidak cukup kuat atau berlawanan),
`manual_review` (manual tanpa gate tetapi weighted AI decisive),
`manual_inconclusive`, `running`, atau `failed`. NETRAL hanya untuk perhitungan
deterministik; vote AI tetap BUY/SELL. Manual tanpa gate tidak pernah masuk Discord.
Kolom legacy `majority_signal` tetap kompatibel: NO_TRADE dipakai bila belum ada
arah AI yang decisive.

Kualitas grafis Auto/50%/75%/100% tetap tersedia dan tersimpan pada perangkat.
Gerakan berjalan dipertahankan; pengujian screenshot memakai pause tab latar
belakang lalu melanjutkan pose yang sama. Kinerja pada HP fisik belum diukur.
Tidak ada eksekusi order trading otomatis.
