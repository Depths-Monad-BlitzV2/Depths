# UI / UX — Depths

## 1. Prinsip

1. **Tensi di atas segalanya.** Keputusan CASH OUT / GO DEEPER adalah momen utama. Beri ruang, suara, dan jeda.
2. **Kecepatan terlihat.** Tampilkan latency setiap tx dalam ms. Itu cerita Monad-nya.
3. **Uang selalu kelihatan.** Bag (yang dipertaruhkan) dan pool (yang bisa didapat) tidak pernah hilang dari layar.
4. **Jangan pernah blank.** Setiap pending state punya animasi diegetic: obor berkedip, langkah kaki, pintu berderit. Tidak boleh ada spinner generik.

## 2. Art direction

- Pixel art 16×16 / 32×32, palet gelap (hitam-ungu-teal). Aksen merah untuk bahaya, emas untuk loot.
- Font: pixel untuk judul dan angka besar (mis. "Press Start 2P" atau "Silkscreen"), sans yang mudah dibaca untuk teks panjang.
- Makin dalam lantai: vignette makin tebal, saturasi merah naik, heartbeat makin cepat (BPM = 60 + floor × 6).
- Aset: pakai pack bebas lisensi (mis. itch.io CC0 / 0x72 Dungeon Tileset) dan catat atribusinya di `apps/web/public/CREDITS.md`.

### 2.1 Battle scene: side-view turn-based

Combat di contract tetap **auto-resolve** dalam satu resolusi `_settle` (GAME_DESIGN §4.3), yang berjalan di dalam tx `descend`/`cashOut` berikutnya (ARCHITECTURE §4.2.1). Hasilnya sudah pasti dan dibaca lewat `previewResolve` sebelum tx itu dikirim. Scene menampilkannya sebagai pertarungan turn-based klasik: hero di kiri, musuh di kanan, gantian menyerang. Urutan, damage, dan pemenang di layar **harus identik** dengan hasil on-chain karena semuanya diturunkan dari `resolveSeed` lewat `packages/game-logic`. Tidak ada angka atau giliran yang dikarang frontend.

```
┌──────────────────────────────── 320 × 180 (logical px) ───────────────────────────────┐
│  dinding + obor (background tier)                                                     │
│                                                                                       │
│                  -31                                     HP ▓▓▓▓▓░░░  Troll           │
│         ┌──┐                                              ┌────┐                      │
│         │H │  ◄── hero 32×32, x≈80                        │ M  │  ◄── musuh, x≈240    │
│ ════════╧══╧══════════════════ lantai y≈140 ══════════════╧════╧═════════════════════ │
│  foreground: kabut / vignette (makin tebal per floor)                                 │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- **Rendering:** React + DOM, sprite sheet via CSS (`background-position` + `steps()`), `image-rendering: pixelated`. Tanpa game engine. Scene cukup 2 aktor + beberapa efek, jadi Phaser/Pixi hanya menambah bundle dan menyulitkan sinkronisasi dengan state zustand.
- **Resolusi:** canvas logis 320×180, di-scale dengan **kelipatan bulat** (×2/×3/×4) mengikuti lebar container. Jangan scale pecahan (pixel jadi blur/tidak rata). Di mobile pakai ×2 dan HUD pindah ke bawah scene.
- **Layer (belakang → depan):** background tier → prop (obor, tangga, peti, lapak merchant) → aktor → efek (angka damage, partikel, flash) → vignette.
- **Satu sumber timing:** scene memutar timeline. `CombatLog` dan HP bar di `StatsHud` mengikuti event timeline yang sama, bukan timer sendiri.

### 2.2 Timeline combat

`packages/game-logic` menyediakan `replayCombat(input) → CombatEvent[]` dengan input dan RNG draw yang sama persis seperti `resolveCombat`:

| Event | Kapan | Animasi |
|---|---|---|
| `potion` | flag `usePotion` | Hero minum, partikel hijau, angka `+50` |
| `flee` (`ok` / `fail`) | aksi FLEE | Hero mundur ke kiri. Sukses: keluar layar, fade. Gagal: tersandung, lanjut ke `monsterHit` gratis |
| `monsterHit` | serangan musuh (termasuk serangan pertama `monsterFirst`) | Musuh maju (lunge), hero `hit` + shake kecil, angka merah |
| `playerHit` | serangan hero | Hero lunge, musuh `hit` + flash putih, angka putih |
| `win` / `dead` / `roundLimit` | akhir combat | `death` musuh + loot jatuh / `death` hero → DeathScreen |

- Setiap hit membawa `damage`, `hpAfter`, dan `strong: boolean` (multiplier ≥ 115%, kosmetik). Hit kuat: angka lebih besar, hitstop 80ms, `crit.ogg`.
- **Tempo:** satu serangan ≈ 350ms (lunge 120ms → impact + angka → kembali), jadi satu round ≈ 700ms. Mulai round ke-6 tempo ×2. Tombol skip (atau `Space`) langsung loncat ke event terakhir.
- **Parity:** `hpAfter` terakhir dan hasil akhir `replayCombat` wajib sama dengan `resolveCombat` di semua test vector.

### 2.3 Staging per encounter

| Encounter | Masuk | Aksi → animasi |
|---|---|---|
| Monster | Musuh muncul dari kegelapan kanan (fade + walk-in) | Lihat §2.2 |
| Treasure | Peti di kanan, berkilau | OPEN: tutup terbuka, koin melayang ke BAG. Mimic: peti bergetar → `mimic_reveal` → combat (§2.2) |
| Trap | Ubin lantai sedikit beda warna di tengah | PROCEED: hero jalan, spike/panah keluar. DISARM: hero berlutut ~600ms → klik (sukses) atau ledakan (gagal) |
| Merchant | NPC + lapak di kanan, idle | BUY: item melayang ke HUD. LEAVE: merchant melambai |

**Transisi lantai:** hero jalan keluar kanan → layar turun gelap (stairs) → ruangan baru, hero masuk dari kiri. Waktu ini sekalian menutupi latency `descend` + tunggu blok target sebelum `previewEncounter` siap (±1.5–2 detik, SPIKE_RESULTS).

### 2.4 Menutupi latency dengan animasi

Hasil belum diketahui sampai receipt `act` masuk **dan** blok target lewat, jadi animasi saat menunggu **tidak boleh** menampilkan hit:
- Setelah klik FIGHT: hero dan musuh maju ke posisi bertarung dan bersiap (stance). Animasi ini ±1.5 detik, cukup menutupi receipt `act` + 1 blok.
- Begitu `previewResolve` siap, timeline §2.2 diputar dari awal. Kalau belum siap setelah stance selesai, aktor tetap idle bersiap (napas, obor berkedip). Tetap tidak boleh ada spinner (§1.4).
- Hasil di layar berasal dari `previewResolve`, dan baru tersimpan on-chain saat player menekan GO DEEPER / CASH OUT (atau saat fallback relay). Karena deterministik, hasilnya tidak akan berubah.

### 2.5 Sprite & animasi

**Hero** (satu karakter, knight 32×32): `idle` (4 frame), `walk` (4), `attack` (3), `hit` (2), `death` (4), `drink` (2).
Upgrade terlihat di sprite (lapisan overlay di atas base hero dengan frame yang sama):
- Pedang: 3 varian sesuai jumlah sword (0 / 1–2 / 3–5): pedang dasar → pedang besi → pedang menyala.
- Perisai: muncul kalau shield ≥ 1, varian kedua di shield ≥ 3.
- Kalau overlay tidak tersedia dari pack, fallback ke badge di `StatsHud` saja (P1, bukan blocker).

**Musuh:** `idle`, `attack`, `hit`, `death` (minimal `idle` + `death`; `attack`/`hit` boleh disimulasikan dengan tween posisi + flash).
**Prop:** peti (`closed`, `open`, `mimic_reveal`), trap (`spike`), merchant (`idle`), obor, tangga.

Ukuran musuh naik per tier supaya kedalaman terasa: tier 1 = 16×16, tier 2 = 16–32, tier 3 = 32×32, tier 4 = 32×32 atau lebih besar (boss look). Tetap integer scale.

### 2.6 Mapping musuh → aset

`monsterId` dari event `EncounterRevealed` dipetakan ke sprite lewat manifest `apps/web/lib/sprites.ts`. Nama monster di GAME_DESIGN §4.1 kosmetik, tapi kalau mau diganti tetap lewat GAME_DESIGN.

| Tier (floor) | Nama | Background | Sumber aset |
|---|---|---|---|
| 1 (1–3) | Rat, Slime, Bat, Goblin | Batu abu, obor kuning | _diisi saat audit aset_ |
| 2 (4–6) | Skeleton, Orc, Wraith, Spider | Batu lembap, jaring, teal | _diisi saat audit aset_ |
| 3 (7–10) | Troll, Minotaur, Lich, Wyvern | Ruang ritual, ungu | _diisi saat audit aset_ |
| 4 (11–20) | Dragon, Demon, Abyss Lord, Void Horror | Lava/void, merah | _diisi saat audit aset_ |

Aturan audit: setiap nama harus punya sprite. Kalau pack utama tidak punya, ambil dari pack CC0 lain dengan gaya dan palet yang cocok, atau palette-swap sprite yang ada (mis. Wraith = recolor ghost). Semua sumber dicatat di `CREDITS.md`.

## 3. Halaman

### 3.1 Landing `/`
- Hero: judul DEPTHS, tagline, angka **PRIZE POOL** besar dan live (animasi count-up saat berubah).
- CTA "ENTER THE DUNGEON — 1 MON".
- Live feed (kanan / bawah di mobile): "0x12…ab mati di Lantai 6 (-4.2 MON)", "0x9f…01 cash out 6.8 MON dari Lantai 8".
- Strip statistik: total run, kematian, lantai terdalam hari ini.
- "How it works" dalam 4 kartu: Bayar → Turun → Pilih → Cash out atau mati.

### 3.2 Game `/play`

```
┌───────────────────────────────────────────────────────────────┐
│ FLOOR 7  ▓▓▓▓▓▓▓░░░  depth meter        POOL 249.6 MON         │
├───────────────────────────────────────┬───────────────────────┤
│                                       │ ❤ HP 64 / 140         │
│        [ DUNGEON SCENE ]              │ ⚔ ATK 32              │
│        sprite player vs encounter     │ 🧪 x2  🗡 x2  🛡 x2    │
│                                       │ 💰 BAG 4.280 MON      │
│                                       ├───────────────────────┤
│  ENCOUNTER CARD                       │ COMBAT / EVENT LOG    │
│  🐉 Troll — HP 120 ATK 24             │ > You hit for 31      │
│  Win chance ≈ 58%                     │ > Troll hits for 22   │
│  [FIGHT] [FLEE 32%] [☐ use potion]    │                       │
├───────────────────────────────────────┴───────────────────────┤
│ TX ▸ descend 932ms ✓ ▸ act 910ms ✓ ▸ descend …                  │
└───────────────────────────────────────────────────────────────┘
```

Komponen (`apps/web/components/game/`):

| Komponen | Tanggung jawab |
|---|---|
| `DepthMeter` | Progres lantai 1–20, penanda rekor pribadi |
| `PoolBadge` | Pool live dan animasi saat ada yang mati (pool naik) |
| `StatsHud` | HP bar (animasi turun/naik), ATK, inventory, BAG |
| `DungeonScene` | Battle scene side-view (§2.1–2.4): layer, staging encounter, transisi lantai, shake saat hit |
| `SpriteActor` | Satu aktor sprite sheet: state animasi, posisi, flip, overlay equipment |
| `useBattleTimeline` | Hook pemutar `CombatEvent[]`: tempo, skip, reduced motion; men-drive scene, HP bar, dan log |
| `EncounterCard` | Info encounter dan tombol aksi sesuai tabel aksi valid |
| `MerchantPanel` | Stepper qty per item, total harga, sisa bag setelah beli |
| `CombatLog` | Teks per event dari `useBattleTimeline` (sinkron dengan scene, ikut di-skip) |
| `DecisionModal` | CASH OUT vs GO DEEPER (lihat §4) |
| `DeathScreen` | Layar mati, kerugian, tombol share, "Try again" |
| `TxTicker` | Riwayat tx run ini: nama fungsi, latency ms, link explorer |
| `SessionWalletChip` | Saldo burner, top-up, withdraw |

### 3.3 Leaderboard `/leaderboard`
Tab: **Deepest Dive** (lantai terdalam), **Biggest Haul** (cash out terbesar), **Hall of the Fallen** (bag terbesar yang hilang).

### 3.4 Verify `/verify/[runId]`
Ambil event run itu, tampilkan setiap lantai: blockhash target, seed, encounter, hasil. Tombol "Recompute locally" menjalankan `game-logic` dan membandingkan hasilnya dengan event (✓/✗).

## 4. Decision modal (momen utama)

```
            ╔══════════════════════════════════╗
            ║        FLOOR 7 CLEARED           ║
            ║                                  ║
            ║   BAG: 4.280 MON   HP: 64/140    ║
            ║                                  ║
            ║  Next floor: monster ≈ HP 145    ║
            ║  ATK 29, loot up to 2.4 MON      ║
            ║                                  ║
            ║ [🟢 CASH OUT 4.280]  [🔴 GO DEEPER] ║
            ╚══════════════════════════════════╝
```

- Background redup dan heartbeat terdengar. Tombol GO DEEPER berdenyut merah.
- Hold-to-confirm 600ms untuk GO DEEPER di floor ≥ 5 (mencegah salah klik, sekaligus menambah drama).
- Tampilkan preview lantai berikutnya (stat monster, loot maksimum) supaya keputusan tetap informatif.
- Hotkey: `C` cash out, `D` go deeper.

## 5. Flow onboarding

1. Connect wallet (RainbowKit). Kalau chain salah → tombol "Switch to Monad Testnet".
2. Saldo kurang → link ke faucet.
3. Modal pertama kali: "Kami membuat session wallet supaya kamu tidak perlu approve tiap langkah" + top-up (default 0.25 MON ≈ 10 lantai, bisa diubah).
4. Satu popup: `enterDungeon` (fee + top-up). Setelah itu langsung masuk animasi turun tangga.

## 6. State pending & error

| Situasi | Tampilan |
|---|---|
| Menunggu blok target setelah `descend` | Kabut bergerak, teks "Something stirs in the dark…" |
| Menunggu blok target setelah `act` | Hero dan musuh maju dan bersiap (stance, tanpa hit). Timeline combat diputar begitu `previewResolve` siap (§2.4) |
| Player diam ≥ 150 blok di encounter / decision modal | Fallback relay otomatis (`reveal`/`settle`) di background tanpa mengganggu layar. Chip kecil "hasil dikunci" di TxTicker |
| Tx revert | Toast singkat, lalu re-sync dari `getRun()` |
| Mendekati expiry (> 200 blok dan fallback relay gagal) | Banner merah: "Koneksi lambat — selesaikan langkah ini atau run hangus" + tombol retry |
| Run expired | DeathScreen dengan penyebab "Lost in the dark (timeout)" |
| Saldo burner rendah | Chip kuning, lalu modal top-up |

## 7. Audio (P2)

`heartbeat.ogg` (loop, rate mengikuti floor), `hit.ogg`, `crit.ogg`, `coin.ogg`, `death.ogg`, `stairs.ogg`, `chest.ogg`, `mimic.ogg`. Default **mute**, toggle di header. Hormati `prefers-reduced-motion`: matikan shake, flash, dan hitstop, ganti lunge dengan fade singkat, dan pakai tempo ×2 sejak round pertama.

## 8. Microcopy

- Entry: "Bayar masuk. Makin dalam, makin kaya."
- Cash out: "Kamu keluar hidup-hidup membawa {x} MON."
- Death: "Kamu mati di Lantai {n}. {x} MON kini milik dungeon."
- Trap: "Kamu menginjak tombol yang jelas-jelas mencurigakan."
- Mimic: "Peti itu… punya gigi."
- Merchant: "Pedagang tersenyum terlalu lebar."
