import { Action, Outcome, POTION_HEAL, type CombatEvent, type Replay, type Resolution } from 'game-logic';
import type { OnchainRun } from './contracts';
import { combatLines, mon, outcomeLine } from './log';

// Timeline scene (UI_UX §2.2–2.3): event combat dari replayCombat + staging encounter non-combat.
// Satu sumber timing untuk scene, HP bar, dan CombatLog. Semua angka berasal dari resolusi on-chain
// (previewResolve + replayCombat), tidak ada yang dikarang frontend.

export type SceneEvent =
  | CombatEvent
  | { type: 'chestOpen'; mimic: boolean }
  | { type: 'loot'; amount: bigint }
  | { type: 'trapHp'; damage: number; hpAfter: number }
  | { type: 'trapLoot'; amount: bigint }
  | { type: 'disarm'; ok: boolean; damage: number; hpAfter: number }
  | { type: 'outcome'; text: string; good: boolean };

/** Tempo dasar (ms). Satu serangan ≈ 350ms; mulai round ke-6 tempo ×2 (UI_UX §2.2). */
export const ATTACK_MS = 350;
export const LUNGE_MS = 120;
export const HITSTOP_MS = 80;
export const FAST_FROM_ROUND = 5; // round 0-based

export interface TempoOptions {
  reducedMotion: boolean;
}

/** Durasi satu event. Reduced motion: tempo ×2 sejak awal, tanpa hitstop (UI_UX §7). */
export function eventDuration(e: SceneEvent, opt: TempoOptions): number {
  const fast = (round: number) => opt.reducedMotion || round >= FAST_FROM_ROUND;
  switch (e.type) {
    case 'playerHit':
    case 'monsterHit': {
      const base = fast(e.round) ? ATTACK_MS / 2 : ATTACK_MS;
      return base + (e.strong && !opt.reducedMotion ? HITSTOP_MS : 0);
    }
    case 'potion':
      return opt.reducedMotion ? 300 : 600;
    case 'flee':
      return opt.reducedMotion ? 350 : 700;
    case 'chestOpen':
      return e.mimic ? 900 : 600;
    case 'disarm':
      return opt.reducedMotion ? 400 : 900;
    case 'trapHp':
    case 'trapLoot':
      return opt.reducedMotion ? 350 : 700;
    case 'loot':
      return 600;
    case 'win':
    case 'dead':
    case 'roundLimit':
      return opt.reducedMotion ? 300 : 700;
    case 'outcome':
      return 0;
  }
}

/** Baris log untuk satu event (CombatLog mengikuti timeline). */
export function eventLine(e: SceneEvent, foe: string): string | null {
  switch (e.type) {
    case 'chestOpen':
      return e.mimic ? 'Peti itu… punya gigi.' : 'Tutup peti berderit terbuka.';
    case 'loot':
      return `+${mon(e.amount)} MON masuk ke bag.`;
    case 'trapHp':
      return `Kamu menginjak tombol yang jelas-jelas mencurigakan. −${e.damage} HP.`;
    case 'trapLoot':
      return `Jebakan merobek tasmu. ${mon(e.amount)} MON jatuh ke kegelapan.`;
    case 'disarm':
      return e.ok ? 'Klik. Jebakan dijinakkan.' : `Jebakan meledak. −${e.damage} HP.`;
    case 'outcome':
      return e.text;
    default:
      return combatLines([e], foe)[0] ?? null;
  }
}

export interface SceneInput {
  run: OnchainRun;
  resolution: Resolution;
  replay: Replay | null;
  /** Loot setelah cap pool. */
  award: bigint;
}

/** HP hero setelah potion (sebelum resolusi), sama dengan contract. */
function hpAfterPotion(run: OnchainRun): number {
  return run.usePotion ? Math.min(run.maxHp, run.hp + POTION_HEAL) : run.hp;
}

/** Bangun timeline lengkap untuk resolusi lantai ini. */
export function buildScene({ run, resolution: res, replay, award }: SceneInput): SceneEvent[] {
  const out: SceneEvent[] = [];
  const action = run.pendingAction;

  if (action === Action.OPEN) {
    const mimic = res.outcome === Outcome.MIMIC_WIN || res.outcome === Outcome.MIMIC_KILLED;
    const events = replay?.events ?? [];
    // potion (kalau ada) diminum sebelum peti dibuka
    const potion = events.filter((e) => e.type === 'potion');
    out.push(...potion, { type: 'chestOpen', mimic }, ...events.filter((e) => e.type !== 'potion'));
  } else if (action === Action.FIGHT || action === Action.FLEE) {
    out.push(...(replay?.events ?? []));
  } else {
    // trap: tidak ada replay combat; potion tetap diminum dulu
    const hp0 = hpAfterPotion(run);
    if (run.usePotion) out.push({ type: 'potion', heal: hp0 - run.hp, hpAfter: hp0 });
    if (res.outcome === Outcome.TRAP_HP) out.push({ type: 'trapHp', damage: hp0 - res.hpAfter, hpAfter: res.hpAfter });
    if (res.outcome === Outcome.TRAP_LOOT) out.push({ type: 'trapLoot', amount: res.bagLoss });
    if (res.outcome === Outcome.DISARM_OK) out.push({ type: 'disarm', ok: true, damage: 0, hpAfter: hp0 });
    if (res.outcome === Outcome.DISARM_FAIL) {
      out.push({ type: 'disarm', ok: false, damage: hp0 - res.hpAfter, hpAfter: res.hpAfter });
      if (!res.survived) out.push({ type: 'dead' });
    }
  }
  if (res.survived && award > 0n) out.push({ type: 'loot', amount: award });
  out.push({ type: 'outcome', text: outcomeLine(res, award), good: res.survived });
  return out;
}

/** HP hero dan monster setelah event ke-`upto` (inklusif), untuk HP bar yang mengikuti timeline. */
export function hpAt(
  events: SceneEvent[],
  upto: number,
  start: { hero: number; monster: number | null },
): { hero: number; monster: number | null } {
  let hero = start.hero;
  let monster = start.monster;
  for (let i = 0; i <= upto && i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'potion' || e.type === 'monsterHit' || e.type === 'trapHp' || e.type === 'disarm') hero = e.hpAfter;
    if (e.type === 'playerHit') monster = e.hpAfter;
    if (e.type === 'dead') hero = 0;
  }
  return { hero, monster };
}
