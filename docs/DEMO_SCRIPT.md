# Demo Script — Depths (3 menit)

## Persiapan (sebelum naik panggung)
- Browser: tab `/play` sudah connect, burner sudah ter-top-up, layar zoom 125%.
- Tab kedua: explorer menampilkan contract (tab Transactions).
- Prize pool ≥ 80 MON (lihat BUILD_PLAN Phase 7). Suara ON, volume sedang.
- Video backup siap di desktop kalau jaringan bermasalah.

## Alur

| Waktu | Yang dilakukan | Yang diucapkan |
|---|---|---|
| 0:00 | Landing, sorot angka POOL | "Ini prize pool Depths. Isinya bukan dari kami, tapi dari semua orang yang **mati** di dungeon ini." |
| 0:15 | Klik ENTER, 1 popup wallet | "Bayar 1 MON. Ini satu-satunya popup yang akan kalian lihat." |
| 0:25 | Lantai 1–3 dimainkan cepat, tunjuk TxTicker | "Setiap lantai itu 2 transaksi on-chain, dan hasil acaknya dari blok masa depan. Lihat latency-nya, di bawah satu detik. Ini Monad. Encounter-nya di-generate on-chain dan bisa diverifikasi." |
| 1:00 | Merchant: beli sword | "Uang yang saya pakai belanja masuk kembali ke pool. Survive lebih lama, tapi bawa pulang lebih sedikit." |
| 1:20 | Decision modal pertama, minta penonton memilih | "Bag saya 2.4 MON. Cash out, atau go deeper? **Kalian yang pilih.**" (ikuti suara terbanyak) |
| 1:40 | Lanjut sampai momen tegang (floor 5+) | Biarkan heartbeat bicara. Diam sejenak sebelum menekan. |
| 2:15 | Hasil: cash out (tunjukkan saldo wallet naik) **atau** mati (tunjukkan pool naik) | Menang: "Masuk ke wallet, real." · Mati: "Dan sekarang 4 MON saya jadi loot untuk kalian." |
| 2:35 | Slide arsitektur 1 gambar | "Commit-reveal dari future blockhash: tidak bisa diintip, tidak bisa di-revert. Session key: nol popup. Cap 5%: pool tidak akan pernah habis." |
| 2:50 | Penutup | "Depths. Berani sampai lantai berapa?" |

## Q&A yang mungkin muncul

- **"Bisa dicurangi lewat blockhash?"** Keputusan di-commit sebelum blok target ada. Menolak reveal = expiry = mati. Sisa risiko di level validator; untuk mainnet kami siapkan Pyth Entropy.
- **"Kalau pool habis?"** Tidak bisa. Setiap award maksimal 5% dari pool, jadi loot mengecil sebelum pool kosong. Simulasi menunjukkan RTP < 100%, jadi pool tumbuh.
- **"Session key aman?"** Burner cuma pegang saldo gas. Payout selalu ke wallet utama, operator tidak bisa menarik bag.
- **"Kenapa harus Monad?"** ±22 tx per run dengan latency sub-detik. Di chain 12 detik/blok, satu run makan lebih dari 4 menit loading.
- **"Ini judi?"** Demo di testnet. Untuk mainnet kami perlu kajian legal; mekaniknya juga bisa dijalankan dengan poin non-moneter.
