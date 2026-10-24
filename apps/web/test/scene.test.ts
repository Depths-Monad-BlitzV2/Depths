import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { Action, MONSTER_NAMES, Outcome, RunState, replayCombat, type Resolution } from 'game-logic';
import type { OnchainRun } from '../lib/contracts';
import { ATTACK_MS, HITSTOP_MS, buildScene, eventDuration, eventLine, hpAt, type SceneEvent } from '../lib/scene';
import { ATLAS_SIZE, MONSTER_SPRITES, SPRITES, TIER_THEMES, swordSprite } from '../lib/sprites';

const SEED: Hex = `0x${'cd'.repeat(32)}`;

function run(over: Partial<OnchainRun> = {}): OnchainRun {
  return {
    operator: '0x0000000000000000000000000000000000000001',
    runId: 1,
    state: RunState.AWAIT_SETTLE,
    floor: 2,
    encounter: 1,
    pendingAction: Action.FIGHT,
    swords: 0,
    shields: 0,
    potions: 1,
    usePotion: false,
    hp: 60,
    maxHp: 100,
    atk: 12,
    monsterId: 1,
    targetBlock: 10n,
    bag: 0n,
    encounterSeed: SEED,
    ...over,
  };
}

describe('buildScene', () => {
  it('FIGHT: event combat replay + loot + outcome, HP akhir = resolusi', () => {
    const r = run();
    const replay = replayCombat({ seed: SEED, kind: 'fight', floor: r.floor, hp: r.hp, maxHp: r.maxHp, atk: r.atk, usePotion: false });
    const events = buildScene({ run: r, resolution: replay.result, replay, award: replay.result.lootTable });
    expect(events.at(-1)?.type).toBe('outcome');
    if (replay.result.survived) {
      expect(events.some((e) => e.type === 'loot')).toBe(true);
      expect(hpAt(events, events.length - 1, { hero: r.hp, monster: 40 }).hero).toBe(replay.result.hpAfter);
    }
  });

  it('OPEN: potion diminum sebelum peti dibuka', () => {
    const r = run({ pendingAction: Action.OPEN, usePotion: true });
    const replay = replayCombat({ seed: SEED, kind: 'open', floor: r.floor, hp: r.hp, maxHp: r.maxHp, atk: r.atk, usePotion: true });
    const events = buildScene({ run: r, resolution: replay.result, replay, award: replay.result.lootTable });
    expect(events[0]?.type).toBe('potion');
    expect(events[1]?.type).toBe('chestOpen');
  });

  it('trap: potion manual, TRAP_HP dengan damage dari HP setelah potion', () => {
    const r = run({ pendingAction: Action.PROCEED, usePotion: true, hp: 30 });
    const res: Resolution = { outcome: Outcome.TRAP_HP, survived: true, hpAfter: 64, lootTable: 0n, bagLoss: 0n };
    const events = buildScene({ run: r, resolution: res, replay: null, award: 0n });
    expect(events[0]).toEqual({ type: 'potion', heal: 50, hpAfter: 80 });
    expect(events[1]).toEqual({ type: 'trapHp', damage: 16, hpAfter: 64 });
    expect(hpAt(events, events.length - 1, { hero: 30, monster: null }).hero).toBe(64);
  });

  it('DISARM gagal fatal → dead', () => {
    const r = run({ pendingAction: Action.DISARM, hp: 20 });
    const res: Resolution = { outcome: Outcome.DISARM_FAIL, survived: false, hpAfter: 0, lootTable: 0n, bagLoss: 0n };
    const types = buildScene({ run: r, resolution: res, replay: null, award: 0n }).map((e) => e.type);
    expect(types).toEqual(['disarm', 'dead', 'outcome']);
  });

  it('TRAP_LOOT dan DISARM_OK', () => {
    const loot = buildScene({
      run: run({ pendingAction: Action.PROCEED, bag: 10n }),
      resolution: { outcome: Outcome.TRAP_LOOT, survived: true, hpAfter: 60, lootTable: 0n, bagLoss: 2n },
      replay: null,
      award: 0n,
    });
    expect(loot[0]).toEqual({ type: 'trapLoot', amount: 2n });
    const ok = buildScene({
      run: run({ pendingAction: Action.DISARM }),
      resolution: { outcome: Outcome.DISARM_OK, survived: true, hpAfter: 60, lootTable: 5n, bagLoss: 0n },
      replay: null,
      award: 5n,
    });
    expect(ok.map((e) => e.type)).toEqual(['disarm', 'loot', 'outcome']);
  });
});

describe('tempo (UI_UX §2.2, §7)', () => {
  const hit = (round: number, strong = false): SceneEvent => ({ type: 'playerHit', round, damage: 5, strong, hpAfter: 1 });
  it('satu serangan ≈ 350ms, hit kuat + hitstop 80ms, round ke-6 ×2', () => {
    expect(eventDuration(hit(0), { reducedMotion: false })).toBe(ATTACK_MS);
    expect(eventDuration(hit(0, true), { reducedMotion: false })).toBe(ATTACK_MS + HITSTOP_MS);
    expect(eventDuration(hit(5), { reducedMotion: false })).toBe(ATTACK_MS / 2);
  });
  it('reduced motion: ×2 sejak awal, tanpa hitstop', () => {
    expect(eventDuration(hit(0, true), { reducedMotion: true })).toBe(ATTACK_MS / 2);
  });
  it('setiap event punya baris log', () => {
    expect(eventLine(hit(0), 'Goblin')).toContain('Goblin');
    expect(eventLine({ type: 'loot', amount: 10n ** 18n }, 'x')).toContain('1.000');
  });
});

describe('sprites', () => {
  it('16 monster terpetakan, sesuai MONSTER_NAMES', () => {
    expect(MONSTER_SPRITES).toHaveLength(MONSTER_NAMES.length);
  });
  it('semua frame di dalam atlas 512×512', () => {
    for (const [k, a] of Object.entries(SPRITES)) {
      const last = a.x + (a.frames - 1) * (a.stride ?? a.w) + a.w;
      expect(last, k).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(a.y + a.h, k).toBeLessThanOrEqual(ATLAS_SIZE);
    }
  });
  it('file atlas dan tile background ada di public/', () => {
    const pub = join(__dirname, '..', 'public');
    expect(existsSync(join(pub, 'assets/0x72/atlas.png'))).toBe(true);
    for (const t of TIER_THEMES) {
      for (const f of [t.floor, t.wall, t.banner]) expect(existsSync(join(pub, `assets/0x72/tiles/${f}.png`)), f).toBe(true);
    }
    expect(existsSync(join(pub, 'CREDITS.md'))).toBe(true);
  });
  it('varian pedang 0 / 1–2 / 3–5', () => {
    expect([0, 1, 2, 3, 5].map(swordSprite)).toEqual(['swordBasic', 'swordIron', 'swordIron', 'swordFlame', 'swordFlame']);
  });
});
