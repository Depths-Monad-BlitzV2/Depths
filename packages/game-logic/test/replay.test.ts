import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  Outcome,
  POTION_HEAL,
  estimateWinChance,
  monster,
  mulberry32,
  rand,
  replayCombat,
  resolveMonster,
  resolveTreasure,
  seedDraw,
  type CombatEvent,
} from '../src';

const combat = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../contracts/test/vectors/combat.json', import.meta.url)), 'utf8'),
) as { monster: { seed: Hex; floor: number; hp: number; atk: number; flee: boolean; outcome: number; hpAfter: number }[] };

const treasure = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../contracts/test/vectors/treasure.json', import.meta.url)), 'utf8'),
) as { cases: { seed: Hex; floor: number; hp: number; atk: number; outcome: number; hpAfter: number }[] };

function lastHp(events: CombatEvent[]): number | undefined {
  const end = events.at(-1);
  return end?.type === 'win' ? end.hpAfter : end?.type === 'dead' || end?.type === 'roundLimit' ? 0 : undefined;
}

describe('replayCombat', () => {
  it.each(combat.monster)('cocok dengan vector monster floor $floor flee=$flee', (v) => {
    const r = replayCombat({
      seed: v.seed,
      kind: v.flee ? 'flee' : 'fight',
      floor: v.floor,
      hp: v.hp,
      maxHp: v.hp,
      atk: v.atk,
      usePotion: false,
    });
    expect(r.result.outcome).toBe(v.outcome);
    expect(r.result.hpAfter).toBe(v.hpAfter);
    if (v.outcome !== Outcome.FLED) expect(lastHp(r.events)).toBe(v.hpAfter);
  });

  it.each(treasure.cases)('cocok dengan vector treasure floor $floor', (v) => {
    const r = replayCombat({ seed: v.seed, kind: 'open', floor: v.floor, hp: v.hp, maxHp: v.hp, atk: v.atk, usePotion: false });
    expect(r.result.outcome).toBe(v.outcome);
    expect(r.result.hpAfter).toBe(v.hpAfter);
    expect(r.opponent === null).toBe(v.outcome === Outcome.TREASURE);
  });

  it('HP di event konsisten dengan damage', () => {
    for (const v of combat.monster) {
      const r = replayCombat({ seed: v.seed, kind: v.flee ? 'flee' : 'fight', floor: v.floor, hp: v.hp, maxHp: v.hp, atk: v.atk, usePotion: false });
      let player = v.hp;
      let foe = r.opponent?.hp ?? 0;
      for (const e of r.events) {
        if (e.type === 'monsterHit') {
          player = Math.max(player - e.damage, 0);
          expect(e.hpAfter).toBe(player);
        } else if (e.type === 'playerHit') {
          foe = Math.max(foe - e.damage, 0);
          expect(e.hpAfter).toBe(foe);
        }
      }
    }
  });

  it('potion diterapkan sebelum resolusi dan dicap Max HP', () => {
    const seed = combat.monster[0]!.seed;
    const r = replayCombat({ seed, kind: 'fight', floor: 3, hp: 80, maxHp: 100, atk: 22, usePotion: true });
    expect(r.events[0]).toEqual({ type: 'potion', heal: 20, hpAfter: 100 });
    const direct = resolveMonster(seedDraw(seed), 3, 100, 22, false);
    expect(r.result).toEqual(direct);

    const r2 = replayCombat({ seed, kind: 'fight', floor: 3, hp: 10, maxHp: 200, atk: 22, usePotion: true });
    expect(r2.events[0]).toEqual({ type: 'potion', heal: POTION_HEAL, hpAfter: 60 });
  });

  it('mimic memakai stat floor + 2 dan monster tidak menyerang duluan', () => {
    let seed: Hex | undefined;
    for (let k = 0; seed === undefined; k++) {
      const s = `0x${k.toString(16).padStart(64, '0')}` as Hex;
      if (rand(s, 0) % 100n < 5n) seed = s;
    }
    const r = replayCombat({ seed, kind: 'open', floor: 5, hp: 300, maxHp: 300, atk: 62, usePotion: false });
    expect(r.opponent?.hp).toBe(monster(7).hp);
    expect(r.events[0]?.type).toBe('playerHit');
    expect(r.result).toEqual(resolveTreasure(seedDraw(seed), 5, 300, 62));
  });
});

describe('estimateWinChance', () => {
  it('ekstrem: pasti menang / pasti kalah', () => {
    const rng = mulberry32(1);
    expect(estimateWinChance({ playerHp: 100, playerAtk: 1000, monsterHp: 30, monsterAtk: 5, monsterFirst: false }, 100, rng)).toBe(1);
    expect(estimateWinChance({ playerHp: 1, playerAtk: 1, monsterHp: 809, monsterAtk: 124, monsterFirst: false }, 100, rng)).toBe(0);
  });
});
