# BYGA AI — Deterministic Gate, Evidence Validation & Adaptive Voting

## Purpose

BYGA memakai AI sebagai lapisan review setelah scanner deterministik. Scanner, bukan AI, menentukan apakah AUTO layak membuka meeting. AI tidak menerima arah gate sehingga tidak di-anchor ke keputusan scanner.

## Production flow

1. Baca closed candles BTCUSDT.P dari `chart_db` secara SELECT-only.
2. Validasi freshness, continuity, OHLC, source, dan kecukupan candle.
3. Hitung empat group deterministik: SMC/ICT, Indicators, Volume, Derivatives / Market Positioning.
4. Gabungkan trend / structure / trigger per group.
5. AUTO hanya memanggil AI bila sekurangnya 2 dari 4 group memberi arah yang sama **dan arah itu mengungguli arah lawan**. Split 2 BUY / 2 SELL adalah `GROUP_CONSENSUS_TIE` dan tidak membuka meeting.
6. MANUAL tetap memanggil delapan analyst walaupun gate deterministic tidak lolos.
7. Dua analyst per group menerima hanya snapshot group miliknya, market regime, timeframe roles, dan locked rubric slot masing-masing.
8. Respons analyst harus JSON dan wajib menyertakan BUY/SELL, confidence 0–100, reason, serta 2–6 `directional_evidence` yang dapat diverifikasi terhadap snapshot. Respons semantic-invalid berstatus error dan tidak ikut voting.
9. Voting menggabungkan reliability historis 0.8–1.2 dan confidence modifier 0.9–1.1.
10. Keputusan decisive membutuhkan minimal 2/3 analyst sukses, raw vote pemenang minimal setengah dari total slot, **raw winner harus lebih banyak dari raw loser**, dan weighted share minimal 60%.
11. AUTO hanya approved bila weighted winner sama dengan deterministic gate. Discord hanya menerima approved result.

## Locked analyst rubrics

- `smc_ict_1`: structure confluence.
- `smc_ict_2`: structure invalidation / adversarial review.
- `indicators_1`: trend + momentum confirmation.
- `indicators_2`: indicator contradiction / overextension review.
- `volume_1`: flow confirmation.
- `volume_2`: flow divergence review.
- `derivatives_1`: positioning confirmation.
- `derivatives_2`: positioning invalidation / squeeze-risk review.

Prompt produksi berada di `src/pipeline/run.js`. `src/prompt/builder.js` adalah jalur legacy dan bukan prompt manual/cron produksi saat ini.

## Derivatives safety

- Open Interest dan Long/Short Ratio harus fresh relatif terhadap timeframe.
- Funding memakai freshness window terpisah karena cadence funding lebih lambat.
- OI memakai configured lookback penuh; data tidak boleh diam-diam memakai lookback yang lebih pendek.
- Perubahan OI hanya dihitung pada trailing rows dari source yang sama.
- OI price confirmation disejajarkan berdasarkan timestamp candle dan expected timeframe span, bukan indeks array.
- Liquidation upstream M5 diagregasi ke interval timeframe yang sedang dinilai.
- Evidence kurang, stale, cross-source, atau misaligned menjadi NETRAL; tidak dibuat menjadi directional vote.
- `chart_db` tetap read-only dari repository ini.

## Adaptive reliability

Reliability dihitung per slot+provider dari outcome harga sekitar dua jam setelah vote. Bila minimal 12 sampel tersedia pada market regime yang sama, regime itu diprioritaskan; jika belum, histori slot+provider dipakai. Accuracy di-shrink ke prior 50% dan weight dibatasi 0.8–1.2. Bila histori tidak cukup atau query gagal, weight kembali ke 1.0.

Confidence model tidak diperlakukan sebagai probabilitas terkalibrasi. Ia hanya memodifikasi weight secara kecil pada rentang 0.9–1.1.

## Provider health

`SEMANTIC_INVALID_AI_RESPONSE` berarti provider berhasil menjawab tetapi output model gagal kontrak trading. Kesalahan ini dikeluarkan dari vote, tetapi tidak diklasifikasikan sebagai outage provider. Timeout, auth, rate limit, network, dan upstream server error tetap memengaruhi Provider Health.

## Auditability

- Production prompt version: `4.0.0`.
- Deterministic engine version: `3.2.0`.
- Market schema version: `3.2.0`.
- Provider adapter version berasal dari adapter provider aktual.
- Directional evidence yang sudah diverifikasi dipersist ke `analysis_results.evidence_json`.
- Provider/model failure tidak pernah diubah menjadi fake BUY/SELL.
- Legacy `NO_TRADE` tetap dapat muncul pada compatibility/history fields, tetapi analyst produksi hanya boleh BUY atau SELL.
