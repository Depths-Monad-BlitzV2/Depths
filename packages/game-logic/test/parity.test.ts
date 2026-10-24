import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  rand,
  resolveCombat,
  resolveMonster,
  resolveTrap,
  resolveTreasure,
  rollEncounter,
  seedDraw,
  type Resolution,
} from '../src';

// Dihasilkan oleh contracts/test/vectors/GenVectors.t.sol (`forge test`).
function vectors<T>(name: string): T {
  const url = new URL(`../../../contracts/test/vectors/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T;
}

interface ResolutionJson {
  outcome: number;
  survived: boolean;
  hpAfter: number;
  lootTable: string;
  bagLoss: string;
}

function expectResolution(actual: Resolution, expected: ResolutionJson) {
  expect({ ...actual, lootTable: actual.lootTable.toString(), bagLoss: actual.bagLoss.toString() }).toEqual({
    outcome: expected.outcome,
    survived: expected.survived,
    hpAfter: expected.hpAfter,
    lootTable: expected.lootTable,
    bagLoss: expected.bagLoss,
  });
}

const encounter = vectors<{
  rand: { seed: Hex; i: number; value: string }[];
  cases: { seed: Hex; floor: number; bag: string; enc: number; monsterId: number }[];
}>('encounter');

const combat = vectors<{
  combat: {
    seed: Hex;
    playerHp: number;
    playerAtk: number;
    monsterHp: number;
    monsterAtk: number;
    monsterFirst: boolean;
    win: boolean;
    hpAfter: number;
  }[];
  monster: ({ seed: Hex; floor: number; hp: number; atk: number; flee: boolean } & ResolutionJson)[];
}>('combat');

const treasure = vectors<{ cases: ({ seed: Hex; floor: number; hp: number; atk: number } & ResolutionJson)[] }>(
  'treasure',
);

const trap = vectors<{
  cases: ({ seed: Hex; floor: number; hp: number; bag: string; disarm: boolean } & ResolutionJson)[];
}>('trap');

describe('parity dengan DepthsLogic.sol', () => {
  it('jumlah vector ≥ 200', () => {
    const total =
      encounter.rand.length +
      encounter.cases.length +
      combat.combat.length +
      combat.monster.length +
      treasure.cases.length +
      trap.cases.length;
    expect(total).toBeGreaterThanOrEqual(200);
  });

  it.each(encounter.rand)('rand($i)', (v) => {
    expect(rand(v.seed, v.i).toString()).toBe(v.value);
  });

  it.each(encounter.cases)('rollEncounter floor $floor', (v) => {
    expect(rollEncounter(seedDraw(v.seed), v.floor, BigInt(v.bag))).toEqual({ enc: v.enc, monsterId: v.monsterId });
  });

  it.each(combat.combat)('resolveCombat hp=$playerHp atk=$playerAtk vs $monsterHp/$monsterAtk', (v) => {
    expect(resolveCombat(seedDraw(v.seed), v)).toEqual({ win: v.win, hpAfter: v.hpAfter });
  });

  it.each(combat.monster)('resolveMonster floor $floor flee=$flee', (v) => {
    expectResolution(resolveMonster(seedDraw(v.seed), v.floor, v.hp, v.atk, v.flee), v);
  });

  it.each(treasure.cases)('resolveTreasure floor $floor', (v) => {
    expectResolution(resolveTreasure(seedDraw(v.seed), v.floor, v.hp, v.atk), v);
  });

  it.each(trap.cases)('resolveTrap floor $floor disarm=$disarm', (v) => {
    expectResolution(resolveTrap(seedDraw(v.seed), v.floor, v.hp, BigInt(v.bag), v.disarm), v);
  });

  it('vector mencakup semua cabang penting', () => {
    const outcomes = new Set([
      ...combat.monster.map((v) => v.outcome),
      ...treasure.cases.map((v) => v.outcome),
      ...trap.cases.map((v) => v.outcome),
    ]);
    // WIN, FLED, FLEE_FAIL_WIN, TREASURE, MIMIC_WIN|MIMIC_KILLED, TRAP_HP, TRAP_LOOT, DISARM_OK, DISARM_FAIL, KILLED
    for (const o of [1, 2, 4, 6, 7, 8, 9, 12]) expect(outcomes).toContain(o);
    expect(outcomes.has(5) || outcomes.has(14)).toBe(true);
    expect(combat.combat.some((v) => v.win)).toBe(true);
    expect(combat.combat.some((v) => !v.win)).toBe(true);
  });
});
