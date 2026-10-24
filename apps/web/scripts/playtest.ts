// Bot playtest Phase 6: N run di chain sungguhan dengan lib/* yang sama dengan /play.
//
//   OWNER_PRIVATE_KEY=0x<funder> RUNS=20 PLAYERS=3 FUND=5 IDLE_RUNS=2 pnpm -F web playtest
//
// - Wallet pemain dibuat baru dan didanai funder; key disimpan di apps/web/.playtest/ (gitignored) supaya
//   dana bisa dipulihkan kalau skrip terhenti (`pnpm -F web playtest refund`).
// - Strategi bergiliran cautious / balanced / greedy (game-logic STRATEGIES): flee kalau estimasi win
//   chance rendah, belanja seperti simulate.ts, potion saat HP rendah, cash out sesuai aturan strategi.
// - IDLE_RUNS run pertama sengaja diam ≥ 150 blok di encounter dan di keputusan → relay reveal/settle.
// - Laporan: RTP aktual, lantai, tx per lantai, latency, tx gagal, run nyangkut (DoD: 0).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, formatEther, parseEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  Action,
  Encounter,
  MAX_FLOOR,
  MAX_POTIONS,
  MAX_SHIELDS,
  MAX_SWORDS,
  MMON,
  POTION_PRICE,
  SHIELD_PRICE,
  SWORD_PRICE,
  estimateWinChance,
  monster,
} from 'game-logic';
// STRATEGIES tidak diekspor dari entry game-logic (simulate.ts memakai node:url, bukan untuk browser)
import { STRATEGIES, type Strategy } from '../../../packages/game-logic/src/simulate';
import { activeChain, transportFor } from '../lib/chains';
import { depthsAbi } from '../lib/contracts';
import { createDepthsClient } from '../lib/client';
import { Narrator, type RunEnd } from '../lib/narrator';
import type { Purchase } from '../lib/runMachine';
import { memoryStore, withdrawSession } from '../lib/session';
import { cleanupRun, createPlayer, enter, keyFromEnv, sleep, stopAll, waitBlock, waitPhase, type Player } from './harness';

const funderKey = keyFromEnv('OWNER_PRIVATE_KEY');
const RUNS = Number(process.env.RUNS ?? 20);
const PLAYERS = Number(process.env.PLAYERS ?? 3);
const FUND = parseEther(process.env.FUND ?? '5');
const IDLE_RUNS = Number(process.env.IDLE_RUNS ?? 2);
const RUN_TIMEOUT_MS = 6 * 60_000;
const DIR = join(process.cwd(), '.playtest');
const KEYS = join(DIR, 'players.json');

const client = createDepthsClient();
const funder = privateKeyToAccount(funderKey);
const funderWallet = createWalletClient({ account: funder, chain: activeChain, transport: transportFor() });

// funder dipakai bersama oleh semua pemain → kirim serial supaya nonce tidak bentrok
let funderLock: Promise<unknown> = Promise.resolve();
function fund(to: Hex, value: bigint): Promise<void> {
  const job = funderLock.then(async () => {
    const hash = await funderWallet.sendTransaction({ to, value });
    const rc = await client.waitForTransactionReceipt({ hash });
    // Monad: saldo baru terlihat konsensus setelah k = 3 blok (SPIKE_RESULTS Phase 6)
    await waitBlock(client, rc.blockNumber + 4n, 'dana pemain:');
  });
  funderLock = job.catch(() => undefined);
  return job;
}

interface RunReport {
  run: number;
  player: string;
  strategy: string;
  result: RunEnd['kind'] | 'stuck';
  floor: number;
  entry: bigint;
  payout: bigint;
  txs: number;
  failed: number;
  relays: number;
  perFloor: string;
  idle: boolean;
}

function playerKeys(): Hex[] {
  mkdirSync(DIR, { recursive: true });
  if (existsSync(KEYS)) return JSON.parse(readFileSync(KEYS, 'utf8')) as Hex[];
  const keys = Array.from({ length: PLAYERS }, () => generatePrivateKey());
  writeFileSync(KEYS, JSON.stringify(keys, null, 2));
  return keys;
}

function choosePurchase(s: Player): Purchase {
  const r = s.machine.snapshot!.run;
  let bag = r.bag;
  const buy: Purchase = { swords: 0, shields: 0, potions: 0 };
  // seperti simulate.ts: sword dulu, shield mengikuti jumlah sword, potion kalau HP < 60%
  while (bag >= SWORD_PRICE && r.swords + buy.swords < MAX_SWORDS) {
    bag -= SWORD_PRICE;
    buy.swords++;
    if (bag >= SHIELD_PRICE && r.shields + buy.shields < r.swords + buy.swords && r.shields + buy.shields < MAX_SHIELDS) {
      bag -= SHIELD_PRICE;
      buy.shields++;
    }
  }
  while (bag >= POTION_PRICE && r.potions + buy.potions < MAX_POTIONS && r.hp < r.maxHp * 0.6) {
    bag -= POTION_PRICE;
    buy.potions++;
  }
  return buy;
}

function shouldCashOut(p: Player, strat: Strategy, bag: bigint, hp: number): boolean {
  const floor = p.machine.snapshot!.run.floor;
  return (
    floor >= MAX_FLOOR ||
    bag >= BigInt(Math.floor(strat.cashAt)) * MMON ||
    floor >= strat.maxFloor ||
    (hp < strat.hpCash && bag > 0n)
  );
}

async function playRun(p: Player, key: Hex, n: number, stratName: string, idle: boolean): Promise<RunReport> {
  const strat = STRATEGIES[stratName]!;
  let end: RunEnd | null = null;
  const narrator = new Narrator({ log: () => {}, ended: (e) => (end = e) });
  const txBefore = p.txs.length;
  const perFloor: number[] = [];
  const [, , , fee] = await client.readContract({ address: p.address, abi: depthsAbi, functionName: 'poolInfo' });

  const sessionBal = await client.getBalance({ address: p.session.address });
  await enter(p, sessionBal < parseEther('0.1') ? parseEther('0.15') : 0n);
  const t0 = Date.now();
  let idledReveal = !idle;
  let idledSettle = !idle;

  const push = () => {
    const s = p.machine.snapshot;
    if (s) narrator.push(s, p.phase);
  };

  try {
    for (;;) {
      if (Date.now() - t0 > RUN_TIMEOUT_MS) throw new Error('stuck');
      const before = p.txs.length;
      let ph = await waitPhase(p, ['encounter', 'resolved', 'cleared', 'dying', 'noRun', 'expired'], RUN_TIMEOUT_MS);
      push();
      if (ph.kind === 'noRun') break;
      if (ph.kind === 'expired') throw new Error('stuck');
      if (ph.kind === 'dying') {
        await waitPhase(p, ['noRun'], 120_000);
        push();
        break;
      }

      if (ph.kind === 'encounter') {
        if (!idledReveal && !ph.locked) {
          // diam di encounter ≥ 150 blok dengan tab terbuka → relay reveal frontend
          idledReveal = true;
          p.machine.start();
          await waitBlock(client, p.machine.snapshot!.run.targetBlock + 152n, `[${p.label}] idle reveal`);
          ph = await waitPhase(p, ['encounter'], 60_000);
          for (let i = 0; i < 30 && !(ph.kind === 'encounter' && ph.locked); i++) {
            await sleep(500);
            ph = await waitPhase(p, ['encounter'], 60_000);
          }
          p.machine.stop();
        }
        if (ph.kind !== 'encounter') continue;
        const r = p.machine.snapshot!.run;
        const lowHp = r.potions > 0 && r.hp < r.maxHp - 40;
        if (ph.encounter === Encounter.MONSTER) {
          const m = monster(r.floor);
          const hp = lowHp ? Math.min(r.maxHp, r.hp + 50) : r.hp;
          const wc = estimateWinChance({ playerHp: hp, playerAtk: r.atk, monsterHp: m.hp, monsterAtk: m.atk, monsterFirst: false }, 300);
          await p.machine.act(wc < strat.fleeBelow ? Action.FLEE : Action.FIGHT, lowHp);
        } else if (ph.encounter === Encounter.TREASURE) {
          await p.machine.act(Action.OPEN, lowHp);
        } else if (ph.encounter === Encounter.TRAP) {
          await p.machine.act(Action.PROCEED);
        } else {
          const buy = choosePurchase(p);
          const any = buy.swords + buy.shields + buy.potions > 0;
          await p.machine.act(any ? Action.BUY : Action.LEAVE, false, buy);
        }
        ph = await waitPhase(p, ['resolved', 'cleared', 'dying', 'noRun'], RUN_TIMEOUT_MS);
        push();
      }

      if (ph.kind === 'resolved' || ph.kind === 'cleared') {
        if (!idledSettle && ph.kind === 'resolved') {
          // diam di decision modal ≥ 150 blok → relay settle frontend
          idledSettle = true;
          p.machine.start();
          await waitBlock(client, p.machine.snapshot!.run.targetBlock + 152n, `[${p.label}] idle settle`);
          ph = await waitPhase(p, ['cleared', 'noRun'], 60_000);
          p.machine.stop();
          push();
          if (ph.kind === 'noRun') break;
        }
        const s = p.machine.snapshot!;
        const bag = ph.kind === 'resolved' ? s.run.bag + ph.award - ph.resolution.bagLoss : s.run.bag;
        const hp = ph.kind === 'resolved' ? ph.resolution.hpAfter : s.run.hp;
        if (shouldCashOut(p, strat, bag, hp)) {
          await p.machine.cashOut();
          perFloor.push(p.txs.length - before);
          await waitPhase(p, ['noRun'], 120_000);
          push();
          break;
        }
        await p.machine.descend();
        perFloor.push(p.txs.length - before);
      }
    }
  } catch (e) {
    console.log(`  [${p.label}] run ${n} masalah: ${(e as Error).message}`);
    await cleanupRun(key, `${p.label}-cleanup`).catch(() => undefined);
    return report('stuck');
  }
  // tx otomatis (settle kematian) bisa masih menunggu receipt saat run sudah tertutup di chain
  for (let i = 0; i < 40 && p.txs.slice(txBefore).some((t) => t.status === 'queued' || t.status === 'pending'); i++) await sleep(250);
  return report(end ? (end as RunEnd).kind : 'stuck');

  function report(result: RunReport['result']): RunReport {
    const txs = p.txs.slice(txBefore);
    const e = end as RunEnd | null;
    return {
      run: n,
      player: p.label,
      strategy: stratName,
      result,
      floor: e?.floor ?? p.machine.snapshot?.run.floor ?? 0,
      entry: fee,
      payout: e && e.kind === 'cashOut' ? e.amount : 0n,
      txs: txs.length,
      failed: txs.filter((t) => t.status === 'failed' || t.status === 'reverted').length,
      relays: txs.filter((t) => t.relay && t.label.includes('relay')).length,
      perFloor: perFloor.join('/'),
      idle,
    };
  }
}

async function refundAll(keys: Hex[]): Promise<void> {
  for (const k of keys) {
    const acct = privateKeyToAccount(k);
    const p = createPlayer(acct.address.slice(0, 6), k, { log: false });
    try {
      await cleanupRun(k, 'refund-cleanup').catch(() => undefined);
      await withdrawSession(client, p.session, acct.address).catch(() => null);
    } finally {
      p.stop();
    }
  }
  for (const k of keys) {
    const acct = privateKeyToAccount(k);
    const [bal, gp] = await Promise.all([client.getBalance({ address: acct.address }), client.getGasPrice()]);
    const fee = 21_000n * gp;
    if (bal <= fee) continue;
    const w = createWalletClient({ account: acct, chain: activeChain, transport: transportFor() });
    const hash = await w.sendTransaction({ to: funder.address, value: bal - fee, gas: 21_000n, gasPrice: gp, type: 'legacy' });
    await client.waitForTransactionReceipt({ hash });
    console.log(`refund ${acct.address}: ${formatEther(bal - fee)} MON → funder`);
  }
}

async function main(): Promise<void> {
  const keys = playerKeys();
  if (process.argv[2] === 'refund') {
    await refundAll(keys);
    return;
  }
  const startFunder = await client.getBalance({ address: funder.address });
  console.log(`funder ${funder.address} saldo ${formatEther(startFunder)} MON | ${RUNS} run, ${PLAYERS} pemain`);

  // satu session store per pemain → burner dipakai ulang antar run, seperti di browser
  const players = keys.map((k, i) => createPlayer(`P${i + 1}`, k, { store: memoryStore() }));
  for (const p of players) {
    const bal = await client.getBalance({ address: p.owner.address });
    if (bal < FUND) await fund(p.owner.address, FUND - bal);
  }

  const strategies = ['cautious', 'balanced', 'greedy'];
  const queue = Array.from({ length: RUNS }, (_, i) => i + 1);
  const reports: RunReport[] = [];
  await Promise.all(
    players.map(async (p, pi) => {
      for (;;) {
        const n = queue.shift();
        if (n === undefined) return;
        const bal = await client.getBalance({ address: p.owner.address });
        if (bal < parseEther('1.6')) await fund(p.owner.address, parseEther('2'));
        const strat = strategies[(n + pi) % strategies.length]!;
        const idle = n <= IDLE_RUNS;
        console.log(`run ${n} → ${p.label} (${strat}${idle ? ', idle → relay' : ''})`);
        const r = await playRun(p, keys[pi]!, n, strat, idle);
        reports.push(r);
        console.log(
          `run ${n} ${p.label}: ${r.result} di lantai ${r.floor}, payout ${formatEther(r.payout)} MON, tx ${r.txs} (gagal ${r.failed}, relay ${r.relays})`,
        );
      }
    }),
  );

  const sorted = reports.sort((a, b) => a.run - b.run);
  const entry = sorted.reduce((s, r) => s + r.entry, 0n);
  const payout = sorted.reduce((s, r) => s + r.payout, 0n);
  const stuck = sorted.filter((r) => r.result === 'stuck').length;
  const lat = sorted.length
    ? players
        .flatMap((p) => p.txs)
        .filter((t) => t.status === 'success' && !t.relay && t.latencyMs !== undefined)
        .map((t) => t.latencyMs!)
        .sort((a, b) => a - b)
    : [];
  const pct = (q: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] ?? 0;

  const lines = [
    `| Run | Pemain | Strategi | Hasil | Lantai | Payout (MON) | Tx | Gagal | Relay | Tx per lantai |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...sorted.map(
      (r) =>
        `| ${r.run}${r.idle ? '*' : ''} | ${r.player} | ${r.strategy} | ${r.result} | ${r.floor} | ${formatEther(r.payout)} | ${r.txs} | ${r.failed} | ${r.relays} | ${r.perFloor} |`,
    ),
    '',
    `Run: ${sorted.length}, nyangkut: **${stuck}**, mati: ${sorted.filter((r) => r.result === 'death').length}, cash out: ${sorted.filter((r) => r.result === 'cashOut').length}`,
    `RTP aktual: **${entry ? ((Number(payout) / Number(entry)) * 100).toFixed(1) : '0'}%** (payout ${formatEther(payout)} / entry ${formatEther(entry)} MON)`,
    `Rata-rata lantai: ${(sorted.reduce((s, r) => s + r.floor, 0) / Math.max(1, sorted.length)).toFixed(1)}`,
    `Tx gagal total: ${sorted.reduce((s, r) => s + r.failed, 0)}, relay: ${sorted.reduce((s, r) => s + r.relays, 0)}`,
    `Latency tx session (tanpa relay): p50 ${pct(0.5)}ms, p95 ${pct(0.95)}ms, n=${lat.length}`,
    `* = run dengan idle ≥ 150 blok (uji relay frontend)`,
  ];
  console.log('\n' + lines.join('\n'));
  writeFileSync(join(DIR, `report-${Date.now()}.md`), lines.join('\n') + '\n');

  stopAll();
  await refundAll(keys);
  const endFunder = await client.getBalance({ address: funder.address });
  console.log(`funder: ${formatEther(startFunder)} → ${formatEther(endFunder)} MON (selisih ${formatEther(endFunder - startFunder)})`);
  process.exitCode = stuck === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => stopAll());
