// E2E headless: menjalankan lib/* yang sama dengan /play (session, txQueue, runMachine, gas) tanpa browser.
//
//   OWNER_PRIVATE_KEY=0x... pnpm -F web e2e                      # pakai apps/web/.env.local (testnet)
//   NEXT_PUBLIC_CHAIN=anvil NEXT_PUBLIC_DEPTHS_ADDRESS=0x... NEXT_PUBLIC_RPC_HTTP=http://127.0.0.1:8545 \
//     OWNER_PRIVATE_KEY=0x... pnpm -F web e2e
//
// Owner hanya mengirim enterDungeon (= satu-satunya popup di UI). Burner memainkan FLOORS lantai lalu cash out.
// Verifikasi: owner 1 tx, burner 2 tx per lantai di jalur normal, latency per tx dicetak.
// Env opsional: FLOORS (default 3), TOPUP_WEI (default 0.25 MON).

import { createWalletClient, formatEther, isHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Action, Encounter, RunState } from 'game-logic';
import { activeChain, transportFor } from '../lib/chains';
import { createDepthsClient } from '../lib/client';
import { depthsAbi, depthsAddress } from '../lib/contracts';
import { combatLines, encounterLine, monsterName, mon, outcomeLine } from '../lib/log';
import { RunMachine, actionName, type Phase } from '../lib/runMachine';
import { DEFAULT_TOPUP, loadOrCreateSession, memoryStore, withdrawSession } from '../lib/session';
import { TxQueue, type TxRecord } from '../lib/txQueue';

const pk = process.env.OWNER_PRIVATE_KEY;
if (!pk || !isHex(pk)) {
  console.error('set OWNER_PRIVATE_KEY=0x...');
  process.exit(1);
}
const FLOORS = Number(process.env.FLOORS ?? 3);
const TOPUP = BigInt(process.env.TOPUP_WEI ?? DEFAULT_TOPUP);

const address = depthsAddress();
const client = createDepthsClient();
const ownerAccount = privateKeyToAccount(pk as Hex);
const owner = ownerAccount.address;
const ownerWallet = createWalletClient({ account: ownerAccount, chain: activeChain, transport: transportFor() });
const session = loadOrCreateSession(owner, memoryStore());

const txs = new Map<number, TxRecord>();
const queue = new TxQueue({
  client,
  account: session.account,
  address,
  onUpdate: (r) => {
    txs.set(r.id, r);
    if (r.status === 'pending') return;
    if (r.status === 'queued') return;
    const lat = r.latencyMs !== undefined ? `${r.latencyMs}ms (submit ${r.submitMs}ms)` : '';
    console.log(`  tx ${r.label.padEnd(18)} ${r.status.padEnd(8)} gas ${r.gas} ${lat} ${r.relay ? '[relay]' : ''}`);
  },
});
let lastPhase: Phase = { kind: 'noRun' };
const machine = new RunMachine({
  client,
  address,
  owner,
  queue,
  onSnapshot: (_s, p) => (lastPhase = p),
  onError: (m) => console.log(`  ! ${m}`),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitPhase(kinds: Phase['kind'][], timeoutMs = 120_000): Promise<Phase> {
  const t0 = Date.now();
  for (;;) {
    await machine.refresh();
    if (kinds.includes(lastPhase.kind)) return lastPhase;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout menunggu ${kinds.join('/')}, fase ${lastPhase.kind}`);
    await sleep(150);
  }
}

function chooseAction(enc: number): number {
  if (enc === Encounter.MONSTER) return Action.FIGHT;
  if (enc === Encounter.TREASURE) return Action.OPEN;
  if (enc === Encounter.TRAP) return Action.PROCEED; // tidak pernah fatal
  return Action.LEAVE;
}

async function main(): Promise<void> {
  console.log(`chain ${activeChain.id} | Depths ${address}`);
  console.log(`owner ${owner} | session ${session.account.address}`);
  await machine.refresh();
  if (lastPhase.kind !== 'noRun') throw new Error(`owner masih punya run aktif (${lastPhase.kind})`);
  const [, , , entryFee] = await client.readContract({ address, abi: depthsAbi, functionName: 'poolInfo' });
  const ownerNonce0 = await client.getTransactionCount({ address: owner });

  // ---- satu-satunya tx dari main wallet
  const t0 = performance.now();
  const enterHash = await ownerWallet.writeContract({
    address,
    abi: depthsAbi,
    functionName: 'enterDungeon',
    args: [session.account.address],
    value: entryFee + TOPUP,
  });
  const enterRcpt = await client.waitForTransactionReceipt({ hash: enterHash });
  console.log(`  tx enterDungeon (owner) ${enterRcpt.status} ${Math.round(performance.now() - t0)}ms`);
  if (enterRcpt.status !== 'success') throw new Error('enterDungeon revert');

  const perFloor: number[] = [];
  let outcome = 'cash out';
  for (;;) {
    const before = txs.size;
    const p = await waitPhase(['encounter', 'cleared', 'noRun', 'expired']);
    if (p.kind !== 'encounter') throw new Error(`fase tak terduga ${p.kind}`);
    const snap = machine.snapshot!;
    const floor = snap.run.floor;
    console.log(`floor ${floor}: ${encounterLine(p.encounter, p.monsterId)} HP ${snap.run.hp}/${snap.run.maxHp}`);
    const a = chooseAction(p.encounter);
    await machine.act(a);

    const r = await waitPhase(['resolved', 'dying', 'cleared', 'noRun']);
    if (r.kind === 'resolved' || r.kind === 'dying') {
      if (r.replay) for (const line of combatLines(r.replay.events, monsterName(p.monsterId))) console.log(`    ${line}`);
      console.log(`    ${actionName(a)} → ${outcomeLine(r.resolution, r.kind === 'resolved' ? r.award : 0n)}`);
    }
    if (r.kind === 'dying' || r.kind === 'noRun') {
      await waitPhase(['noRun']);
      outcome = `mati di floor ${floor}`;
      perFloor.push(txs.size - before);
      break;
    }
    const last = floor >= FLOORS || floor >= 20;
    if (last) await machine.cashOut();
    else await machine.descend();
    perFloor.push(txs.size - before);
    if (last) break;
  }

  const final = await waitPhase(['noRun']);
  void final;
  const ownerTxs = (await client.getTransactionCount({ address: owner })) - ownerNonce0;
  const all = [...txs.values()];
  const decisions = all.filter((t) => !t.relay);
  const lat = decisions.map((t) => t.latencyMs ?? 0).sort((x, y) => x - y);
  const p50 = lat[Math.floor(lat.length / 2)] ?? 0;
  const p95 = lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] ?? 0;

  console.log('');
  console.log(`hasil: ${outcome}`);
  console.log(`tx owner (popup): ${ownerTxs}`);
  console.log(`tx session per lantai: ${perFloor.join(', ')}`);
  console.log(`latency tx session: p50 ${p50}ms, p95 ${p95}ms, n=${lat.length}`);
  console.log(`semua tx sukses: ${all.every((t) => t.status === 'success')}`);

  const hash = await withdrawSession(client, session.account, owner);
  console.log(`sisa burner dikembalikan: ${hash ?? 'tidak ada'}`);
  const pool = await client.readContract({ address, abi: depthsAbi, functionName: 'poolInfo' });
  console.log(`pool ${mon(pool[0])} MON, reserved ${formatEther(pool[1])}, treasury ${formatEther(pool[2])}`);

  const ok =
    ownerTxs === 1 &&
    all.every((t) => t.status === 'success') &&
    perFloor.every((n, i) => n === 2 || (i === perFloor.length - 1 && outcome !== 'cash out'));
  const state = (await client.readContract({ address, abi: depthsAbi, functionName: 'getRun', args: [owner] })).state;
  if (!ok || state !== RunState.NONE) {
    console.error('E2E GAGAL');
    process.exit(1);
  }
  console.log('E2E OK');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => machine.stop());
