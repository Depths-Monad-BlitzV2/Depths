# Playtest — Depths (Phase 6)

Contract: `0x0970e0Ffd32a883E5E42Aa3933AE1594580a65AC` (Monad testnet). Kebijakan tuning (product owner, 2026-10-23): **tidak redeploy kecuali ada bug P0**. RTP dari puluhan run hanya pembanding; acuan RTP tetap simulasi 100k run (GAME_DESIGN §9).

## 1. Edge case otomatis (`pnpm -F web edge <skenario>`)

Menjalankan `lib/*` yang sama dengan `/play` di testnet. "Refresh" = machine dan queue dibuang lalu dibuat ulang dari chain dengan burner yang sama.

| Skenario | Hasil | Catatan |
|---|---|---|
| `refresh` | OK | Refresh di AWAIT_REVEAL, AWAIT_ACTION, AWAIT_SETTLE, FLOOR_CLEARED pulih ke fase yang benar. Relay frontend otomatis `reveal` dan `settle` tepat setelah 150 blok saat player diam (tab terbuka) |
| `expiry` | OK | Tab ditutup > 256 blok tanpa keeper: saat load fase `expired`, `reapExpired` menutup run. Dengan keeper menyala, run di-relay keeper di ±200 blok (teramati tidak sengaja: keeper Phase 3 masih hidup) |
| `burner` | OK setelah perbaikan | Saldo session 0: tx gagal sebelum masuk chain (tanpa gas terbuang) dengan pesan "Saldo session wallet tidak cukup… Top-up". Setelah top-up lanjut normal. Dua bug ditemukan dan diperbaiki (lihat §3) |
| `rpc` | OK | RPC utama mati → fallback ke RPC cadangan, run selesai |
| Salah chain | Manual | Lihat §4 |

## 2. Bot playtest (`pnpm -F web playtest`)

2026-10-23, dua batch (19 + 4 run). Pemain bot memakai `lib/*` yang sama dengan `/play`, strategi bergiliran (GAME_DESIGN §9): flee kalau estimasi win chance rendah, belanja di merchant, potion saat HP rendah, cash out sesuai aturan strategi. Tiga run sengaja diam ≥ 150 blok (uji relay frontend).

| Run | Strategi | Hasil | Lantai | Payout (MON) | Catatan |
|---|---|---|---|---|---|
| A1* | balanced | cash out | 4 | 1.000 | relay reveal + settle |
| A3 | cautious | cash out | 3 | 0.900 | |
| A4 | balanced | cash out | 8 | 0.520 | belanja di merchant |
| A5 | greedy | mati | 12 | 0 | lantai terdalam |
| A6 | cautious | cash out | 5 | 1.780 | |
| A7 | balanced | cash out | 8 | 2.600 | |
| A8 | greedy | mati | 6 | 0 | |
| A9 | cautious | mati | 4 | 0 | flee gagal |
| A10 | balanced | cash out | 4 | 2.500 | |
| A11 | greedy | mati | 10 | 0 | |
| A12 | cautious | cash out | 2 | 0.800 | |
| A13 | balanced | mati | 4 | 0 | |
| A14 | greedy | mati | 6 | 0 | |
| A15 | cautious | cash out | 4 | 1.420 | |
| A16 | balanced | cash out | 6 | 2.808 | |
| A17 | greedy | mati | 5 | 0 | |
| A18 | cautious | cash out | 3 | 0.900 | |
| A19 | balanced | cash out | 8 | 2.540 | |
| A20 | greedy | mati | 4 | 0 | |
| B1* | balanced | cash out | 8 | 0.104 | relay reveal + settle |
| B2* | cautious | cash out | 4 | 1.660 | relay reveal + settle (pemain kedua) |
| B3 | balanced | cash out | 4 | 0.900 | |
| B4 | balanced | cash out | 8 | 0.340 | |

\* idle ≥ 150 blok. Run A2 tidak pernah dimulai: `enterDungeon` pemain kedua ditolak karena dananya baru masuk < 3 blok (reserve balance, §3 #5), bukan run yang nyangkut.

**Ringkasan:** 23 run selesai, **0 nyangkut**, 15 cash out, 8 mati, lantai terdalam 12, rata-rata 5.7.
- Tx: 2 tx per lantai di jalur normal (run idle 3–4 karena tx relay). 0 tx gagal di chain; 7 relay frontend sukses + 8 settle kematian otomatis sukses.
- Latency tx session (batch B, tanpa relay): p50 714 ms, p95 1418 ms (n = 48).
- **RTP aktual 90.3%** (payout 20.772 / entry 23 MON). Per strategi: cautious 106.6% (7 run), balanced 133% (10 run), greedy 0% (6 run). Simulasi 100k: 90.5 / 74.9 / 38.4%. Sampel terlalu kecil untuk tuning (deviasi satu run sampai ±2.8 MON); sesuai kebijakan, tidak ada perubahan angka atau redeploy.
- Biaya: saldo deployer turun 13.79 → 8.88 MON (entry fee masuk pool/treasury, pool sekarang ±92 MON).

## 3. Bug yang ditemukan dan diperbaiki

| # | Prioritas | Gejala | Penyebab | Perbaikan |
|---|---|---|---|---|
| 1 | P0 | Setelah Top-up, langkah berikutnya tetap gagal "insufficient balance" walau saldo cukup | Monad: saldo konsensus tertunda 3 blok, dan RPC mengingat penolakan per hash, jadi retry raw yang sama selalu ditolak | `txQueue`: tunggu 4 blok lalu tanda tangani ulang (hash baru). SPIKE_RESULTS §Temuan Phase 6 |
| 2 | P1 | Pesan error tx tidak jelas ("Missing or invalid parameters") | `shortMessage` viem generik; alasan asli ada di `details` | `txQueue` memakai `details`; `describeTxError` menerjemahkan ke pesan pemain |
| 3 | P1 | Error saldo kurang tertutup "method not available" | `fallback` viem mem-fallback error semantik ke RPC cadangan | `rpcShouldThrow`: fallback hanya untuk error jaringan/kapasitas |
| 4 | P1 | Modal keputusan / layar akhir terpotong di ponsel | Scene ×1 hanya 180 px tinggi | Overlay jadi modal layar penuh di bawah breakpoint `md` |
| 5 | P2 | `enterDungeon` tepat setelah wallet utama diisi ditolak "Missing or invalid parameters" | Reserve balance (sama dengan #1) di sisi wallet utama | Pesan jelas di UI ("baru saja diisi… tunggu beberapa detik"); bot menunggu 4 blok setelah pendanaan |
| 6 | P2 | Landing Lighthouse performance 87 | Seluruh landing client component (viem, ABI, game-logic dimuat sebelum render) | Landing jadi server component + island lazy; performance 92–97, first load 246 → 121 kB |

## 4. Checklist manual (browser, MetaMask/Rabby)

Jalankan `pnpm -F web dev`, buka `http://localhost:3000/play`. Centang dan catat siapa yang menguji.

- [ ] Salah chain: wallet di jaringan lain → muncul "Switch to Monad Testnet", setelah switch game lanjut normal
- [ ] Refresh browser di encounter, setelah klik aksi (stance), saat animasi pertarungan, dan di decision modal → kembali ke state yang sama
- [ ] Tutup tab saat encounter, buka lagi setelah ±1 menit (relay belum) dan setelah ±3 menit (expired) → layar sesuai
- [ ] Saldo session rendah → chip kuning, Top-up dari wallet utama, langkah berikutnya jalan
- [ ] Ponsel (atau DevTools 390 px): scene, encounter card, decision modal, layar mati terbaca dan bisa diklik
- [ ] Landing dan leaderboard menampilkan pool dan run terbaru

### Feedback pemain

| Pemain | Run | Lantai terdalam | Hasil | Feedback |
|---|---|---|---|---|
| | | | | |
