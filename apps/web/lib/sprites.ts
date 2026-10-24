// Manifest sprite 0x72 DungeonTileset II v1.7 (CC0, lihat public/CREDITS.md).
// Koordinat dari assets/0x72/tile_list_v1.7.txt. Frame animasi tersusun horizontal di atlas:
// frame i ada di x + i × stride, y sama, sehingga bisa diputar dengan CSS `steps()`.

export const ATLAS_URL = '/assets/0x72/atlas.png';
export const ATLAS_SIZE = 512;
export const TILE_URL = (name: string) => `/assets/0x72/tiles/${name}.png`;

export interface SpriteAnim {
  x: number;
  y: number;
  w: number;
  h: number;
  frames: number;
  /** Jarak antar frame (default = w). */
  stride?: number;
  fps: number;
}

const anim = (x: number, y: number, w: number, h: number, frames = 4, fps = 8, stride?: number): SpriteAnim => ({
  x,
  y,
  w,
  h,
  frames,
  fps,
  stride,
});
const still = (x: number, y: number, w: number, h: number): SpriteAnim => anim(x, y, w, h, 1, 1);

/** Semua sprite yang dipakai scene. */
export const SPRITES = {
  // hero (knight_m): idle/run/hit. attack, death, drink disimulasikan dengan tween (UI_UX §2.5)
  heroIdle: anim(128, 100, 16, 28),
  heroRun: anim(192, 100, 16, 28, 4, 12),
  heroHit: still(256, 100, 16, 28),

  // monster tier 1 (floor 1–3)
  tinyZombieIdle: anim(368, 16, 16, 16),
  tinyZombieRun: anim(432, 16, 16, 16, 4, 12),
  swampy: anim(432, 112, 16, 16),
  impIdle: anim(368, 64, 16, 16),
  impRun: anim(432, 64, 16, 16, 4, 12),
  goblinIdle: anim(368, 40, 16, 16),
  goblinRun: anim(432, 40, 16, 16, 4, 12),
  // tier 2 (4–6)
  skeletIdle: anim(368, 88, 16, 16),
  skeletRun: anim(432, 88, 16, 16, 4, 12),
  maskedOrcIdle: anim(368, 153, 16, 23),
  maskedOrcRun: anim(432, 153, 16, 23, 4, 12),
  angelIdle: anim(368, 304, 16, 16),
  angelRun: anim(432, 304, 16, 16, 4, 12),
  orcShamanIdle: anim(368, 201, 16, 23),
  orcShamanRun: anim(432, 201, 16, 23, 4, 12),
  // tier 3 (7–10)
  ogreIdle: anim(16, 380, 32, 36),
  ogreRun: anim(144, 380, 32, 36, 4, 12),
  orcWarriorIdle: anim(368, 177, 16, 23),
  orcWarriorRun: anim(432, 177, 16, 23, 4, 12),
  necromancer: anim(368, 225, 16, 23),
  chortIdle: anim(368, 273, 16, 23),
  chortRun: anim(432, 273, 16, 23, 4, 12),
  // tier 4 (11–20)
  bigZombieIdle: anim(16, 332, 32, 36),
  bigZombieRun: anim(144, 332, 32, 36, 4, 12),
  bigDemonIdle: anim(16, 428, 32, 36),
  bigDemonRun: anim(144, 428, 32, 36, 4, 12),

  // NPC merchant
  merchant: anim(368, 345, 16, 23, 4, 6),

  // prop
  chestFull: anim(304, 416, 16, 16, 3, 10),
  chestEmpty: anim(304, 400, 16, 16, 3, 10),
  chestMimic: anim(304, 432, 16, 16, 3, 10),
  spikes: anim(16, 192, 16, 16, 4, 12),
  coin: anim(289, 385, 6, 7, 4, 10, 8),
  flaskRed: still(288, 336, 16, 16),
  flaskGreen: still(320, 336, 16, 16),
  skull: still(288, 432, 16, 16),
  crate: still(288, 408, 16, 24),
  stairs: still(80, 192, 16, 16),
  fountainMidRed: anim(64, 16, 16, 16, 3, 6),
  fountainBasinRed: anim(64, 32, 16, 16, 3, 6),
  fountainMidBlue: anim(64, 48, 16, 16, 3, 6),
  fountainBasinBlue: anim(64, 64, 16, 16, 3, 6),

  // overlay senjata hero (UI_UX §2.5): 0 / 1–2 / 3–5 sword
  swordBasic: still(323, 10, 10, 21),
  swordIron: still(339, 98, 10, 29),
  swordFlame: still(307, 129, 10, 30),
} as const satisfies Record<string, SpriteAnim>;

export type SpriteKey = keyof typeof SPRITES;

export interface MonsterSprite {
  idle: SpriteKey;
  /** Dipakai saat walk-in dan lunge. */
  run: SpriteKey;
  /** Skala integer di kanvas logis 320×180. */
  scale: 2 | 3;
  /** Recolor (palette swap) lewat CSS filter. */
  filter?: string;
}

const m = (idle: SpriteKey, run: SpriteKey, scale: 2 | 3, filter?: string): MonsterSprite => ({ idle, run, scale, filter });

/**
 * `monsterId` (tier × 4 + rand % 4) → sprite, sesuai GAME_DESIGN §4.1 dan UI_UX §2.6.
 * Semua digambar ×2 (sama dengan tile) supaya kerapatan pixel seragam; ukuran naik dari sprite aslinya:
 * tier 1 16×16, tier 2 16×16–16×23, tier 3 16×23 / ogre 32×36, tier 4 32×36, dan boss (Abyss Lord, Void Horror) ×3.
 */
export const MONSTER_SPRITES: readonly MonsterSprite[] = [
  m('tinyZombieIdle', 'tinyZombieRun', 2), // 0 Tiny Zombie
  m('swampy', 'swampy', 2), // 1 Slime
  m('impIdle', 'impRun', 2), // 2 Imp
  m('goblinIdle', 'goblinRun', 2), // 3 Goblin
  m('skeletIdle', 'skeletRun', 2), // 4 Skeleton
  m('maskedOrcIdle', 'maskedOrcRun', 2), // 5 Orc
  m('angelIdle', 'angelRun', 2, 'grayscale(1) brightness(1.3) sepia(0.4) hue-rotate(130deg) opacity(0.85)'), // 6 Wraith
  m('orcShamanIdle', 'orcShamanRun', 2), // 7 Orc Shaman
  m('ogreIdle', 'ogreRun', 2), // 8 Troll
  m('orcWarriorIdle', 'orcWarriorRun', 2), // 9 Orc Warlord
  m('necromancer', 'necromancer', 2), // 10 Lich
  m('chortIdle', 'chortRun', 2), // 11 Chort
  m('bigZombieIdle', 'bigZombieRun', 2), // 12 Abomination
  m('bigDemonIdle', 'bigDemonRun', 2), // 13 Demon
  m('bigDemonIdle', 'bigDemonRun', 3, 'hue-rotate(230deg) saturate(1.4) brightness(0.9)'), // 14 Abyss Lord
  m('ogreIdle', 'ogreRun', 3, 'grayscale(0.6) hue-rotate(220deg) saturate(2) brightness(0.65) contrast(1.3)'), // 15 Void Horror
];

export function monsterSprite(monsterId: number): MonsterSprite {
  return MONSTER_SPRITES[monsterId] ?? MONSTER_SPRITES[0]!;
}

/** Varian pedang overlay dari jumlah sword (UI_UX §2.5). */
export function swordSprite(swords: number): SpriteKey {
  if (swords >= 3) return 'swordFlame';
  if (swords >= 1) return 'swordIron';
  return 'swordBasic';
}

export interface TierTheme {
  /** Tile lantai dan dinding. */
  floor: string;
  wall: string;
  banner: string;
  /** Tint suasana (overlay multiply) dan warna cahaya obor. */
  tint: string;
  light: string;
  fountain: 'red' | 'blue' | null;
}

/** Background per tier (UI_UX §2.6), index = `tierOf(floor)` dari game-logic (1–3, 4–6, 7–10, 11–20). */
export const TIER_THEMES: readonly TierTheme[] = [
  { floor: 'floor_1', wall: 'wall_mid', banner: 'wall_banner_yellow', tint: '#3a3428', light: '#f5b84a', fountain: null },
  { floor: 'floor_3', wall: 'wall_goo', banner: 'wall_banner_green', tint: '#183a3a', light: '#4fd1c5', fountain: 'blue' },
  { floor: 'floor_6', wall: 'wall_mid', banner: 'wall_banner_blue', tint: '#2a1a40', light: '#b48cff', fountain: null },
  { floor: 'floor_8', wall: 'wall_hole_1', banner: 'wall_banner_red', tint: '#401414', light: '#ff5a36', fountain: 'red' },
];
