import { MAX_ROUNDS } from './tables';
import { randomDraw, type Draw } from './rng';

/** Damage dengan variasi 80%–120% (`roll41` = rand % 41), minimal 1. */
export function dmgFromRoll(atk: number, roll41: number): number {
  const d = Math.floor((atk * (80 + roll41)) / 100);
  return d === 0 ? 1 : d;
}

/** Mirror DepthsLogic.dmg untuk nilai rand mentah. */
export function dmg(atk: number, r: bigint): number {
  return dmgFromRoll(atk, Number(r % 41n));
}

/** Hit dengan multiplier ≥ 115% ditampilkan sebagai "hit kuat" (kosmetik, UI_UX §2.2). */
export const STRONG_ROLL = 35;

export type CombatEvent =
  | { type: 'potion'; heal: number; hpAfter: number }
  | { type: 'flee'; ok: boolean; chance: number }
  | { type: 'monsterHit'; round: number; damage: number; strong: boolean; hpAfter: number }
  | { type: 'playerHit'; round: number; damage: number; strong: boolean; hpAfter: number }
  | { type: 'win'; hpAfter: number }
  | { type: 'dead' }
  | { type: 'roundLimit' };

export type CombatSink = (e: CombatEvent) => void;

export interface CombatInput {
  playerHp: number;
  playerAtk: number;
  monsterHp: number;
  monsterAtk: number;
  monsterFirst: boolean;
}

export interface CombatResult {
  win: boolean;
  /** HP player setelah combat (0 kalau kalah). */
  hpAfter: number;
}

/**
 * Mirror DepthsLogic.resolveCombat (GAME_DESIGN §4.3). Draw serangan mulai index 1.
 * `onEvent` menerima setiap serangan untuk replay; tidak mengubah draw apa pun.
 * Pada `monsterHit`, `hpAfter` = HP player; pada `playerHit`, `hpAfter` = HP monster.
 */
export function resolveCombat(draw: Draw, input: CombatInput, onEvent?: CombatSink): CombatResult {
  let ph = input.playerHp;
  let mh = input.monsterHp;
  let i = 1;
  const monsterHit = (round: number): boolean => {
    const roll = draw(i++, 41);
    const damage = dmgFromRoll(input.monsterAtk, roll);
    ph -= damage;
    onEvent?.({ type: 'monsterHit', round, damage, strong: roll >= STRONG_ROLL, hpAfter: Math.max(ph, 0) });
    if (ph <= 0) {
      onEvent?.({ type: 'dead' });
      return true;
    }
    return false;
  };

  if (input.monsterFirst && monsterHit(0)) return { win: false, hpAfter: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roll = draw(i++, 41);
    const damage = dmgFromRoll(input.playerAtk, roll);
    mh -= damage;
    onEvent?.({ type: 'playerHit', round, damage, strong: roll >= STRONG_ROLL, hpAfter: Math.max(mh, 0) });
    if (mh <= 0) {
      onEvent?.({ type: 'win', hpAfter: ph });
      return { win: true, hpAfter: ph };
    }
    if (monsterHit(round)) return { win: false, hpAfter: 0 };
  }
  onEvent?.({ type: 'roundLimit' });
  return { win: false, hpAfter: 0 };
}

/**
 * Estimasi win chance untuk UI (GAME_DESIGN §4.3): Monte Carlo dengan PRNG biasa.
 * Statistik sama dengan keccak karena output keccak uniform. Labelnya tetap *estimasi*.
 */
export function estimateWinChance(input: CombatInput, n = 500, rng: () => number = Math.random): number {
  const draw = randomDraw(rng);
  let wins = 0;
  for (let k = 0; k < n; k++) if (resolveCombat(draw, input).win) wins++;
  return wins / n;
}
