# Security & Threat Model — Depths

Contract ini memegang uang player. Setiap PR yang menyentuh `contracts/src` harus dicek terhadap daftar di bawah.

## 1. Aset yang dilindungi

| Aset | Pemilik | Ancaman utama |
|---|---|---|
| `reserved` (bag player yang masih hidup) | player | dicuri, terkunci, payout salah alamat |
| `pool` | komunitas player | dikuras oleh exploit RNG atau owner |
| `treasury` | owner | — |
| Saldo session wallet | player | kebocoran localStorage |

## 2. Randomness

| Serangan | Mitigasi |
|---|---|
| Simulasi hasil di tx yang sama lalu revert kalau buruk (contract penyerang) | Seed memakai `blockhash(targetBlock)` dengan `targetBlock = block.number + 1` saat commit. Hasil **tidak bisa** dihitung di tx commit |
| Melihat hasil off-chain (`previewResolve`) lalu tidak mengirim tx berikutnya | Memang didesain terlihat (ARCHITECTURE §4.2.1). Pilihan sudah ter-commit. Fallback relay mengunci hasil, atau expiry = **mati**. Tidak ada re-roll dalam kondisi apa pun |
| Menunggu blockhash "bagus" sebelum `descend` | Saat `descend`, blok target belum ada, jadi tidak ada informasi yang bisa ditunggu |
| Validator/proposer memanipulasi blockhash | Risiko diterima untuk testnet (nilai kecil). Mainnet: ganti ke Pyth Entropy (ARCHITECTURE §4.3) |
| Seed sama dipakai di dua tempat | Seed di-domain-separate dengan `owner, runId, floor, purpose`, lalu draw ke-i memakai `keccak(seed, i)` |
| `blockhash` = 0 (terlalu lama atau blok saat ini) | Cek `block.number > targetBlock` dan expiry **sebelum** memanggil `blockhash`. Tetap revert kalau hasilnya 0 |

## 3. Uang

- **Checks-Effects-Interactions** di `cashOut`, `enterDungeon` (forward top-up), dan `withdrawTreasury`. Hapus/ubah state dulu, baru transfer.
- `nonReentrant` di semua fungsi yang mengirim MON: `enterDungeon`, `cashOut`, `settle` (auto cash out floor 20), `withdrawTreasury`. Guard memakai `ReentrancyGuardTransient` (TSTORE, terverifikasi di Monad testnet). `act`, `descend`, `reveal`, `reapExpired` tidak pernah mengirim MON. `_settle` sendiri tidak pernah transfer; auto cash out floor 20 dijalankan pemanggil sebagai langkah terakhir.
- Saat transfer terjadi, run sudah `NONE` dan bag sudah 0, jadi callback penerima yang memanggil fungsi run lain akan revert `NotRunController`/`WrongState` (diuji `test_enter_reentrantOperatorBlocked`).
- Slither (Phase 2, `uvx --from slither-analyzer slither . --filter-paths "lib|test|script|spike" --exclude-informational --exclude-optimization`): **0 temuan**.
- Transfer pakai `call{value:}` dan revert `TransferFailed` kalau gagal. Owner yang berupa contract tanpa `receive` tidak bisa cash out; dokumentasikan ini di FAQ (EOA saja).
- **Tidak ada** fungsi admin yang bisa menarik `pool` atau `reserved`. `pause` hanya memblokir entry baru.
- Award loot selalu `min(table, pool * MAX_AWARD_BPS / 1e4)` → `pool` tidak pernah negatif atau habis.
- Penggunaan `uint128` untuk uang: cast dari `msg.value` harus dicek (`SafeCast`).
- `selfdestruct`/forced send bisa membuat `balance > sum`. Itu aman (invariant memakai `>=`).

## 4. Access control

| Fungsi | Boleh dipanggil |
|---|---|
| `descend`, `act`, `cashOut` (termasuk `_reveal`/`_settle` internal) | owner run **atau** operator yang terdaftar untuk owner itu |
| `reveal`, `settle`, `reapExpired` | siapa saja (deterministik, tidak ada input yang bisa dimanipulasi) |
| admin | `owner()` lewat `Ownable2Step` |

- Payout `cashOut` **selalu** ke `owner`, tidak pernah ke `msg.sender`.
- Satu operator hanya untuk satu owner aktif (`OperatorInUse`). Tautan `_operatorOf` tidak dihapus saat run selesai (alasan gas), tapi `operatorOf()`/`ownerOf()` hanya menganggapnya sah kalau run owner aktif **dan** `run.operator == operator`. Diuji `test_staleOperator_*`.
- Operator tidak bisa memulai run baru atas nama owner (`enterDungeon` memakai `msg.sender` sebagai owner).

## 5. Session key (frontend)

- Private key burner disimpan di `localStorage`. Anggap bisa bocor (XSS, extension).
- Batasi exposure: top-up maksimal `MAX_GAS_TOPUP` (0.5 MON), default 0.25 MON.
- Hal terburuk kalau bocor: penyerang bisa memainkan run (bisa sengaja mati) dan menghabiskan saldo gas burner. Penyerang **tidak bisa** menarik bag. Ini didokumentasikan di FAQ sebagai trade-off UX.
- CSP ketat di Next.js. Jangan pakai `dangerouslySetInnerHTML`. Jangan pakai script pihak ketiga selain wallet SDK.

## 6. Griefing & liveness

| Skenario | Dampak | Mitigasi |
|---|---|---|
| Player offline saat AWAIT_REVEAL/SETTLE | Run expired → mati | Fallback relay frontend (150 blok) + keeper (200 blok) + banner peringatan di UI |
| RPC down saat demo | Run expired | RPC cadangan, keeper jalan di mesin terpisah |
| Spam `reveal` oleh pihak lain | Tidak ada (hasil identik) | — |
| Gas limit per jalur terlalu kecil (`descend`/`cashOut` dengan combat panjang) | Revert (gas tetap dibayar), lalu bisa expired | Limit dihitung dari `rounds` hasil `replayCombat` + margin. Kalau revert out-of-gas, retry sekali dengan limit worst case. Keeper selalu memakai worst case |

## 7. Checklist sebelum deploy

- [ ] `forge test` hijau, termasuk invariant (≥ 256 runs × depth 100)
- [ ] `forge coverage` ≥ 90% line untuk `src/`
- [ ] Slither tanpa temuan high/medium yang belum dijelaskan
- [ ] Parity test TS ↔ Solidity hijau
- [ ] Gas limit frontend sudah di-update dari gas report
- [ ] Deployer key tidak ada di repo (`git grep -i "PRIVATE_KEY=0x"` kosong)
- [ ] Ownership ditransfer ke wallet tim (bukan hot key deployer), kalau relevan
- [ ] Hanya testnet. Mainnet membutuhkan audit + kajian legal
