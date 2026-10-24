// Monte Carlo RTP (GAME_DESIGN §9). Port dari docs/reference/sim-prototype.js, tapi memakai
// fungsi resolusi yang sama dengan contract (dmg integer, MAX_ROUNDS, mimic floor+2, potion sebelum resolusi).
// Model: pool dianggap tak terbatas (tanpa cap 5%), trap selalu PROCEED, treasure selalu OPEN tanpa potion.
//
//   pnpm -F game-logic simulate [--runs 100000] [--seed 1]

import { fileURLToPath } from 'node:url';
import { estimateWinChance } from './combat';
import { mulberry32, randomDraw, type Draw } from './rng';
import { resolveMonster, resolveTrap, resolveTreasure, rollEncounter } from './resolve';
import { BASE_ATK, BASE_HP, ENTRY_FEE_MMON, MAX_FLOOR, MMON, POTION_HEAL, monster } from './tables';
import { Encounter } from './types';

export interface Strategy {
  /** Flee kalau estimasi win chance di bawah ini. */
  fleeBelow: number;
  /** Cash out kalau bag ≥ ini (mMON). */
  cashAt: number;
  /** Cash out paling lambat setelah floor ini clear. */
  maxFloor: number;
  /** Cash out kalau HP di bawah ini dan bag > 0. */
  hpCash: number;
}

export const STRATEGIES: Record<string, Strategy> = {
  cautious: { fleeBelow: 0.7, cashAt: 1200, maxFloor: 5, hpCash: 40 },
  balanced: { fleeBelow: 0.6, cashAt: 2400, maxFloor: 8, hpCash: 30 },
  greedy: { fleeBelow: 0.5, cashAt: 6000, maxFloor: 12, hpCash: 15 },
  yolo: { fleeBelow: 0, cashAt: Number.POSITIVE_INFINITY, maxFloor: MAX_FLOOR, hpCash: 0 },
};

interface RunResult {
  floor: number;
  /** Payout dalam mMON (0 kalau mati). */
  payout: number;
}

// GAME_DESIGN §7
const SWORD = 400n * MMON;
const SHIELD = 400n * MMON;
const POTION = 200n * MMON;

export function simulateRun(s: Strategy, rng: () => number, winChanceSamples = 200): RunResult {
  const draw: Draw = randomDraw(rng);
  let hp = BASE_HP;
  let maxHp = BASE_HP;
  let atk = BASE_ATK;
  let potions = 0;
  let swords = 0;
  let shields = 0;
  let bag = 0n;

  for (let floor = 1; floor <= MAX_FLOOR; floor++) {
    const { enc } = rollEncounter(draw, floor);
    if (enc === Encounter.MONSTER) {
      if (hp < maxHp - 40 && potions > 0) {
        potions--;
        hp = Math.min(maxHp, hp + POTION_HEAL);
      }
      const m = monster(floor);
      const wc = estimateWinChance(
        { playerHp: hp, playerAtk: atk, monsterHp: m.hp, monsterAtk: m.atk, monsterFirst: false },
        winChanceSamples,
        rng,
      );
      const res = resolveMonster(draw, floor, hp, atk, wc < s.fleeBelow);
      if (!res.survived) return { floor, payout: 0 };
      hp = res.hpAfter;
      bag += res.lootTable;
    } else if (enc === Encounter.TREASURE) {
      const res = resolveTreasure(draw, floor, hp, atk);
      if (!res.survived) return { floor, payout: 0 };
      hp = res.hpAfter;
      bag += res.lootTable;
    } else if (enc === Encounter.TRAP) {
      const res = resolveTrap(draw, floor, hp, bag, false);
      hp = res.hpAfter;
      bag -= res.bagLoss;
    } else {
      // Merchant: sword dulu, shield mengikuti jumlah sword, potion kalau HP < 60%.
      while (bag >= SWORD && swords < 5) {
        bag -= SWORD;
        swords++;
        atk += 10;
        if (bag >= SHIELD && shields < swords && shields < 5) {
          bag -= SHIELD;
          shields++;
          maxHp += 20;
          hp += 20;
        }
      }
      while (bag >= POTION && potions < 3 && hp < maxHp * 0.6) {
        bag -= POTION;
        potions++;
      }
    }
    const bagMmon = Number(bag / MMON);
    if (bagMmon >= s.cashAt || floor >= s.maxFloor || (hp < s.hpCash && bag > 0n)) {
      return { floor, payout: bagMmon };
    }
  }
  return { floor: MAX_FLOOR, payout: Number(bag / MMON) };
}

export interface StrategyReport {
  rtp: number;
  zeroPayout: number;
  avgFloor: number;
  /** Porsi run dengan payout ≥ 2× entry fee. */
  bigPayout: number;
}

export function simulate(s: Strategy, runs: number, seed: number): StrategyReport {
  const rng = mulberry32(seed);
  let paid = 0;
  let zero = 0;
  let floors = 0;
  let big = 0;
  for (let k = 0; k < runs; k++) {
    const r = simulateRun(s, rng);
    paid += r.payout;
    floors += r.floor;
    if (r.payout === 0) zero++;
    if (r.payout >= 2 * ENTRY_FEE_MMON) big++;
  }
  return { rtp: paid / runs / ENTRY_FEE_MMON, zeroPayout: zero / runs, avgFloor: floors / runs, bigPayout: big / runs };
}

function arg(name: string, fallback: number): number {
  const k = process.argv.indexOf(`--${name}`);
  const v = k >= 0 ? Number(process.argv[k + 1]) : fallback;
  return Number.isFinite(v) ? v : fallback;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runs = arg('runs', 100_000);
  const seed = arg('seed', 1);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`runs=${runs} seed=${seed}\n`);
  console.log('| Strategi | RTP | Payout nol | Rata-rata floor | Payout ≥ 2× entry |');
  console.log('|---|---|---|---|---|');
  for (const [name, s] of Object.entries(STRATEGIES)) {
    const r = simulate(s, runs, seed);
    console.log(`| ${name} | ${pct(r.rtp)} | ${pct(r.zeroPayout)} | ${r.avgFloor.toFixed(1)} | ${pct(r.bigPayout)} |`);
  }
}
