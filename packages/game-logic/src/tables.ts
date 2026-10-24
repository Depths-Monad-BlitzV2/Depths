// Mirror konstanta DepthsLogic.sol. Sumber kebenaran: docs/GAME_DESIGN.md.

export const MMON = 10n ** 15n;

export const MAX_FLOOR = 20;
export const BASE_HP = 100;
export const BASE_ATK = 12;
export const MAX_ROUNDS = 64;
export const POTION_HEAL = 50;
export const ENTRY_FEE_MMON = 50;

/** Index = floor - 1. Loot dalam mMON. GAME_DESIGN §4.1 */
const HP = [30, 40, 52, 65, 80, 100, 120, 145, 170, 200, 230, 265, 304, 350, 402, 463, 532, 612, 704, 809] as const;
const ATK = [5, 7, 9, 12, 15, 19, 24, 29, 34, 40, 45, 50, 56, 63, 70, 79, 88, 99, 111, 124] as const;
const LOOT = [10, 15, 20, 30, 50, 70, 90, 120, 160, 200, 230, 265, 304, 350, 402, 463, 532, 612, 704, 809] as const;

export interface MonsterStats {
  hp: number;
  atk: number;
  /** Loot tabel dalam wei, sebelum cap pool. */
  loot: bigint;
}

export function monster(floor: number): MonsterStats {
  const k = floor - 1;
  const hp = HP[k];
  const atk = ATK[k];
  const loot = LOOT[k];
  if (!Number.isInteger(floor) || hp === undefined || atk === undefined || loot === undefined) {
    throw new RangeError(`InvalidFloor: ${floor}`);
  }
  return { hp, atk, loot: BigInt(loot) * MMON };
}

/** Nama kosmetik per `monsterId` (tier * 4 + index). GAME_DESIGN §4.1 */
export const MONSTER_NAMES = [
  'Rat', 'Slime', 'Bat', 'Goblin',
  'Skeleton', 'Orc', 'Wraith', 'Spider',
  'Troll', 'Minotaur', 'Lich', 'Wyvern',
  'Dragon', 'Demon', 'Abyss Lord', 'Void Horror',
] as const;

export type MonsterName = (typeof MONSTER_NAMES)[number];

export function tierOf(floor: number): number {
  if (floor <= 3) return 0;
  if (floor <= 6) return 1;
  if (floor <= 10) return 2;
  return 3;
}
