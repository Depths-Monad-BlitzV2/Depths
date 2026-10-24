# PRD — Depths: On-Chain Roguelike Dungeon

> "Bayar masuk. Makin dalam, makin kaya. Tapi kalau mati, hilang semua. Berani sampai lantai berapa?"

| | |
|---|---|
| Status | Draft v1 |
| Tanggal | 2026-10-20 |
| Chain | Monad (testnet dulu, mainnet opsional) |
| Dokumen terkait | [GAME_DESIGN.md](GAME_DESIGN.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [CONTRACT_SPEC.md](CONTRACT_SPEC.md) · [BUILD_PLAN.md](BUILD_PLAN.md) · [SECURITY.md](SECURITY.md) · [UI_UX.md](UI_UX.md) · [DEMO_SCRIPT.md](DEMO_SCRIPT.md) |

---

## 1. Ringkasan

Depths adalah web game roguelike push-your-luck yang seluruh state dan uangnya ada di smart contract Monad. Player bayar entry fee (default 0.05 MON) lalu turun lantai demi lantai. Di setiap lantai contract men-generate encounter acak: monster, treasure, trap, atau merchant. Player memilih aksi. Kalau survive, player memilih **CASH OUT** (bawa pulang semua loot) atau **GO DEEPER** (lantai lebih berbahaya, loot lebih besar). Kalau mati, semua loot run itu hilang dan masuk ke prize pool, jadi dungeon makin kaya setiap ada yang mati.

## 2. Problem & peluang

- **Game on-chain biasanya terasa lambat.** Satu aksi berarti satu popup wallet dan beberapa detik loading, jadi tensi game hilang.
- **Monad** punya block ~400ms dan finality ~800ms. Itu cukup cepat untuk loop game turn-based yang terasa real-time, asal UX-nya tidak memaksa popup di setiap aksi.
- **Push-your-luck dengan uang sungguhan** (mekanik ala "Deal or No Deal") membuat penonton ikut tegang. Cocok untuk demo hackathon: juri melihat sendiri keputusan hidup-mati di setiap lantai.

## 3. Goals

| # | Goal | Metrik sukses |
|---|---|---|
| G1 | Loop game terasa real-time | Median latency dari klik aksi sampai hasil tampil **< 1.5 detik** di Monad testnet |
| G2 | Cuma satu popup wallet per run | Popup hanya waktu `enterDungeon` dan, opsional, cash out. Semua aksi lain lewat session key |
| G3 | Ekonomi self-sustaining dan selalu solvent | Invariant `balance ≥ pool + reserved + treasury` tidak pernah dilanggar (dibuktikan lewat invariant test) |
| G4 | Hasil verifiable | Setiap encounter dan hasil combat bisa di-replay dari seed yang di-emit di event |
| G5 | Demo yang bikin teriak | Demo 3 menit dengan minimal 1 momen "cash out vs go deeper" live di panggung |

## 4. Non-goals (v1)

- NFT item / karakter / cosmetic.
- Multiplayer real-time (PvP, co-op).
- Token sendiri. Semua pakai MON native.
- Mobile app native. Cukup web responsive.
- Combat yang kompleks (skill tree, kelas karakter). Combat sengaja dibuat sederhana.
- Integrasi VRF eksternal di v1 (Pyth Entropy masuk *stretch goal*, lihat ARCHITECTURE §4).

## 5. Target user

1. **Juri dan penonton hackathon.** Butuh paham dalam 10 detik dan merasakan tensinya.
2. **Degen / crypto native di Monad.** Familiar dengan wallet, suka risk-reward, ingin bukti fairness.
3. **Gamer kasual web3.** Tidak mau ribet: tanpa popup berulang, tanpa harus mengerti gas.

## 6. User stories

| ID | Sebagai… | Aku ingin… | Supaya… | Prioritas |
|---|---|---|---|---|
| US-01 | player | connect wallet ke Monad testnet dengan 1 klik (auto add/switch chain) | langsung main | P0 |
| US-02 | player | bayar entry fee dan masuk lantai 1 | mulai run | P0 |
| US-03 | player | melihat encounter lantai ini beserta stat musuh dan estimasi peluang menang | bisa ambil keputusan | P0 |
| US-04 | player | memilih aksi (fight / flee / pakai potion / open / leave / disarm / buy) | mempengaruhi hasil | P0 |
| US-05 | player | melihat animasi combat round per round | merasakan tensinya | P0 |
| US-06 | player | memilih CASH OUT atau GO DEEPER setelah lantai selesai | mengontrol risiko | P0 |
| US-07 | player | menerima MON di wallet waktu cash out | dapat hasil nyata | P0 |
| US-08 | player | main tanpa popup wallet di setiap aksi | game terasa cepat | P0 |
| US-09 | player | melihat prize pool sekarang dan live feed kematian / cash out | FOMO dan social proof | P1 |
| US-10 | player | melihat leaderboard (lantai terdalam, cash out terbesar, kerugian terbesar) | flex | P1 |
| US-11 | player | memverifikasi hasil encounter dari seed on-chain | percaya game-nya fair | P1 |
| US-12 | player | melanjutkan run setelah refresh atau tutup tab (selama belum timeout) | tidak kehilangan progres | P0 |
| US-13 | player | melihat latency setiap tx (ms) | merasakan kecepatan Monad | P1 |
| US-14 | owner | seed prize pool dan mengatur entry fee | bootstrap ekonomi | P0 |
| US-15 | owner | pause entry baru dalam keadaan darurat tanpa mengunci dana player | keamanan | P0 |
| US-16 | player | sound effect (heartbeat makin cepat di lantai dalam) | imersi | P2 |

## 7. Scope fitur

### P0 (MVP, wajib untuk demo)
- Smart contract `Depths` lengkap: entry, state machine per lantai, 4 tipe encounter, combat, merchant, cash out, death, prize pool, rake.
- Randomness commit-reveal berbasis blockhash block berikutnya (detail di ARCHITECTURE §4).
- Session key (burner wallet operator) supaya aksi in-run tanpa popup.
- Reveal/settle lazy di dalam tx `act`/`descend`/`cashOut` (2 tx per lantai), dengan fallback relay dari frontend dan keeper bot (ARCHITECTURE §4.2.1).
- Frontend: landing, layar game (scene, HUD, encounter, aksi, combat log, modal keputusan), recovery run.
- Deploy ke Monad testnet, contract terverifikasi di explorer.

### P1
- Leaderboard on-chain (top 10) dan halaman Hall of the Fallen.
- Live feed event (kematian / cash out / pool berubah).
- Panel "Verify this run" (replay seed → hasil).
- TX latency ticker.
- Estimasi win chance (Monte Carlo di client).

### P2 / stretch
- Sound design dan haptics.
- Pyth Entropy sebagai randomness provider alternatif.
- Shareable death card (OG image: "Mati di lantai 7 membawa 0.31 MON").
- Mode spectator: tonton run orang lain secara live.

## 8. Ringkasan mekanik

Detail lengkap dan semua angka ada di [GAME_DESIGN.md](GAME_DESIGN.md).

- Entry fee 0.05 MON. 95% masuk prize pool, 5% ke treasury.
- Stat awal player: HP 100, ATK 10.
- Encounter per lantai: Monster 40%, Treasure 25% (5% di antaranya Mimic), Trap 15%, Merchant 20%.
- Loot dari monster/treasure diambil dari prize pool ke "bag" run (di-escrow di contract).
- Mati → bag kembali ke pool. Cash out → bag dikirim ke wallet player.
- Lantai maksimum 20. Setelah lantai 20 selesai, cash out otomatis.

## 9. Requirement non-fungsional

| Area | Requirement |
|---|---|
| Performa | Respons UI optimistic < 100ms. Hasil on-chain < 1.5s (p50), < 3s (p95) |
| Fairness | Player tidak bisa memilih atau memprediksi randomness sebelum keputusannya ter-commit (lihat SECURITY §2) |
| Solvency | Contract tidak pernah berutang melebihi saldonya. Loot per award dibatasi persentase pool |
| Recovery | Semua state run ada on-chain. Frontend bisa rebuild UI dari `getRun(owner)` |
| Gas | Gas limit eksplisit per fungsi (Monad menagih berdasarkan **gas limit**, bukan gas used) |
| Aksesibilitas | Bisa dimainkan dengan keyboard. Kontras AA. Ada opsi reduce motion |
| Browser | Chrome, Brave, Firefox, Safari terbaru. Wallet: MetaMask, Rabby, Phantom (EVM), Backpack |

## 10. Metrik (dipantau dari event on-chain)

- Jumlah run per jam, rata-rata lantai tercapai, persentase cash out vs death.
- RTP aktual (total payout ÷ total entry fee). Target 80–92%.
- Ukuran prize pool dari waktu ke waktu.
- Latency tx p50/p95 (dicatat di client).

## 11. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Randomness blockhash bisa dimanipulasi validator | Hasil tidak fair | Dampaknya kecil di testnet. Mitigasi commit-reveal dan aturan expiry = death. Pyth Entropy disiapkan sebagai upgrade |
| Player "stall" untuk menghindari hasil buruk | Exploit | Window blockhash 256 block. Lewat dari itu dianggap **mati**, tidak ada re-roll |
| Prize pool kosong | Loot nol, game membosankan | Seed pool awal. Cap award 5% dari pool membuat pool tidak pernah habis |
| Session key bocor (localStorage) | Kehilangan saldo gas burner | Burner cuma berisi saldo gas kecil. Payout **selalu** ke wallet owner, bukan ke operator |
| blockhash / perilaku EVM Monad berbeda dari Ethereum | Contract gagal | Phase 0 spike: verifikasi di testnet sebelum membangun logic |
| Legal: game dengan taruhan uang nyata | Perjudian dilarang di banyak yurisdiksi, termasuk Indonesia | v1 **hanya testnet**. Mainnet butuh kajian hukum terpisah dan geofencing |
| RPC publik kena rate limit saat demo | Demo macet | Siapkan RPC cadangan (provider berbayar) dan fallback transport di wagmi |

## 12. Pertanyaan terbuka

1. Rake 5%: ke treasury tim, atau di-burn / dikembalikan ke pool?
2. Apakah player boleh punya lebih dari 1 run aktif per wallet? (v1: tidak)
3. Perlu mainnet untuk hackathon, atau testnet cukup? (rekomendasi: testnet)
4. Siapa yang menjalankan keeper bot waktu demo? (rekomendasi: laptop tim plus 1 VPS)
