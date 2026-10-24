import { MAX_FLOOR, MMON, monster, tierOf } from './tables';
import { resolveCombat, type CombatSink } from './combat';
import type { Draw } from './rng';
import { Encounter, Outcome, type Resolution } from './types';

/** Mirror DepthsLogic.rollEncounter. `monsterId = tier * 4 + rand(1) % 4`. */
export function rollEncounter(draw: Draw, floor: number): { enc: Encounter; monsterId: number } {
  const r = draw(0, 100);
  const enc = r < 40 ? Encounter.MONSTER : r < 65 ? Encounter.TREASURE : r < 80 ? Encounter.TRAP : Encounter.MERCHANT;
  return { enc, monsterId: tierOf(floor) * 4 + draw(1, 4) };
}

/** Peluang flee sukses dalam persen: max(20, 60 − 4 × floor). */
export function fleeChance(floor: number): number {
  return Math.max(20, 60 - 4 * floor);
}

function died(outcome: Outcome): Resolution {
  return { outcome, survived: false, hpAfter: 0, lootTable: 0n, bagLoss: 0n };
}

/** Mirror DepthsLogic.resolveMonster (FIGHT / FLEE). */
export function resolveMonster(
  draw: Draw,
  floor: number,
  hp: number,
  atk: number,
  flee: boolean,
  onEvent?: CombatSink,
): Resolution {
  const m = monster(floor);
  if (flee) {
    const chance = fleeChance(floor);
    const ok = draw(0, 100) < chance;
    onEvent?.({ type: 'flee', ok, chance });
    if (ok) return { outcome: Outcome.FLED, survived: true, hpAfter: hp, lootTable: 0n, bagLoss: 0n };
  }
  const c = resolveCombat(
    draw,
    { playerHp: hp, playerAtk: atk, monsterHp: m.hp, monsterAtk: m.atk, monsterFirst: flee },
    onEvent,
  );
  if (!c.win) return died(flee ? Outcome.FLEE_FAIL_KILLED : Outcome.KILLED);
  return {
    outcome: flee ? Outcome.FLEE_FAIL_WIN : Outcome.WIN,
    survived: true,
    hpAfter: c.hpAfter,
    lootTable: m.loot,
    bagLoss: 0n,
  };
}

/** Floor stat mimic: floor + 2, maks MAX_FLOOR. */
export function mimicFloor(floor: number): number {
  return Math.min(floor + 2, MAX_FLOOR);
}

/** Mirror DepthsLogic.resolveTreasure (OPEN). */
export function resolveTreasure(draw: Draw, floor: number, hp: number, atk: number, onEvent?: CombatSink): Resolution {
  if (draw(0, 100) < 5) {
    const m = monster(mimicFloor(floor));
    const c = resolveCombat(
      draw,
      { playerHp: hp, playerAtk: atk, monsterHp: m.hp, monsterAtk: m.atk, monsterFirst: false },
      onEvent,
    );
    if (!c.win) return died(Outcome.MIMIC_KILLED);
    return { outcome: Outcome.MIMIC_WIN, survived: true, hpAfter: c.hpAfter, lootTable: monster(floor).loot * 2n, bagLoss: 0n };
  }
  const amount = BigInt(10 + draw(1, 41)) * MMON;
  return { outcome: Outcome.TREASURE, survived: true, hpAfter: hp, lootTable: amount, bagLoss: 0n };
}

/** Mirror DepthsLogic.resolveTrap (PROCEED / DISARM). */
export function resolveTrap(draw: Draw, floor: number, hp: number, bag: bigint, disarm: boolean): Resolution {
  const r = draw(0, 100);
  const base = 10 + 3 * floor;
  if (disarm) {
    if (r < 50) {
      return { outcome: Outcome.DISARM_OK, survived: true, hpAfter: hp, lootTable: BigInt(5 * floor) * MMON, bagLoss: 0n };
    }
    const loss = 2 * base;
    if (loss >= hp) return died(Outcome.DISARM_FAIL);
    return { outcome: Outcome.DISARM_FAIL, survived: true, hpAfter: hp - loss, lootTable: 0n, bagLoss: 0n };
  }
  if (r < 60 || bag === 0n) {
    return { outcome: Outcome.TRAP_HP, survived: true, hpAfter: base >= hp ? 1 : hp - base, lootTable: 0n, bagLoss: 0n };
  }
  return { outcome: Outcome.TRAP_LOOT, survived: true, hpAfter: hp, lootTable: 0n, bagLoss: bag / 5n };
}
