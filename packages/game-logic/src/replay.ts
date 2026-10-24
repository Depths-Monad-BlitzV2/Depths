import type { Hex } from 'viem';
import { POTION_HEAL, monster, type MonsterStats } from './tables';
import type { CombatEvent } from './combat';
import { mimicFloor, resolveMonster, resolveTreasure } from './resolve';
import { seedDraw } from './rng';
import type { Resolution } from './types';

export type ReplayKind = 'fight' | 'flee' | 'open';

export interface ReplayInput {
  /** `resolveSeed` dari event FloorResolved. */
  seed: Hex;
  kind: ReplayKind;
  floor: number;
  /** Stat player sebelum resolusi (sebelum potion). */
  hp: number;
  maxHp: number;
  atk: number;
  usePotion: boolean;
}

export interface Replay {
  events: CombatEvent[];
  result: Resolution;
  /** Lawan yang dihadapi; `null` kalau OPEN bukan mimic atau flee sukses tanpa combat. */
  opponent: MonsterStats | null;
}

/**
 * Timeline untuk battle scene (UI_UX §2.2). Memakai draw yang sama persis dengan
 * resolusi on-chain, jadi `result` wajib sama dengan hasil `settle`.
 * Potion diterapkan sebelum resolusi, sama seperti contract.
 */
export function replayCombat(input: ReplayInput): Replay {
  const events: CombatEvent[] = [];
  const sink = (e: CombatEvent) => events.push(e);
  let hp = input.hp;
  if (input.usePotion) {
    hp = Math.min(input.maxHp, hp + POTION_HEAL);
    events.push({ type: 'potion', heal: hp - input.hp, hpAfter: hp });
  }
  const draw = seedDraw(input.seed);
  if (input.kind === 'open') {
    const result = resolveTreasure(draw, input.floor, hp, input.atk, sink);
    const isMimic = events.some((e) => e.type === 'playerHit' || e.type === 'monsterHit');
    return { events, result, opponent: isMimic ? monster(mimicFloor(input.floor)) : null };
  }
  const result = resolveMonster(draw, input.floor, hp, input.atk, input.kind === 'flee', sink);
  const fledClean = events.some((e) => e.type === 'flee' && e.ok);
  return { events, result, opponent: fledClean ? null : monster(input.floor) };
}
