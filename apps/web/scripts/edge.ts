// Uji edge case Phase 6 di chain sungguhan (BUILD_PLAN Phase 6, ARCHITECTURE §6.3, UI_UX §6).
//
//   OWNER_PRIVATE_KEY=0x... pnpm -F web edge [refresh|expiry|burner|rpc|all]
//
// refresh : refresh di tiap state (AWAIT_REVEAL, AWAIT_ACTION, AWAIT_SETTLE, FLOOR_CLEARED) + relay otomatis
//           frontend setelah 150 blok saat player diam (reveal dan settle)
// expiry  : tab ditutup > 256 blok tanpa keeper → fase expired → reapExpired → run tertutup
// burner  : session wallet tanpa saldo → tx gagal dengan pesan jelas, setelah top-up lanjut normal
// rpc     : RPC utama mati → fallback transport ke RPC cadangan, run tetap selesai
// Salah chain diuji manual di browser (wagmi), lihat docs/PLAYTEST.md.

import { createWalletClient, fallback, http, parseEther } from 'viem';
import { RunState } from 'game-logic';
import { activeChain, rpcShouldThrow, rpcUrls, transportFor } from '../lib/chains';
import { createDepthsClient } from '../lib/client';
import { describeTxError } from '../lib/txQueue';
import { cleanupRun, createPlayer, enter, keyFromEnv, ownerState, safeAction, stopAll, waitBlock, waitPhase, type Player } from './harness';

const ownerKey = keyFromEnv('OWNER_PRIVATE_KEY');
const TOPUP = parseEther('0.1');
const results: { name: string; ok: boolean; note: string }[] = [];

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

/** Mulai dari keadaan bersih: run tertinggal ditutup dulu oleh owner. */
async function ensureNoRun(p: Player) {
  if ((await p.refreshPage()).kind !== 'noRun') await cleanupRun(ownerKey);
  const ph = await p.refreshPage();
  check(ph.kind === 'noRun', `owner masih punya run aktif (${ph.kind})`);
}

/** Selesaikan run yang sedang di FLOOR_CLEARED / resolved dengan cash out. */
async function finish(p: Player) {
  const ph = await waitPhase(p, ['resolved', 'cleared', 'noRun', 'dying']);
  if (ph.kind === 'resolved' || ph.kind === 'cleared') await p.machine.cashOut();
  await waitPhase(p, ['noRun']);
}

async function scenarioRefresh() {
  console.log('\n== refresh di tiap state + relay frontend');
  const p = createPlayer('refresh', ownerKey);
  await ensureNoRun(p);
  await enter(p, TOPUP);

  // AWAIT_REVEAL: refresh sebelum dan sesudah blok target
  let ph = await p.refreshPage();
  check(ph.kind === 'waitReveal' || ph.kind === 'encounter', `AWAIT_REVEAL → ${ph.kind}`);
  ph = await waitPhase(p, ['encounter']);
  check(ph.kind === 'encounter' && !ph.locked, 'encounter belum terkunci');
  console.log('  ok: refresh di AWAIT_REVEAL → encounter dari previewEncounter');

  // player diam ≥ 150 blok dengan tab terbuka → relay reveal otomatis
  await p.refreshPage();
  p.machine.start();
  const target = p.machine.snapshot!.run.targetBlock;
  await waitBlock(p.client, target + 152n, 'relay reveal:');
  ph = await waitPhase(p, ['encounter'], 60_000);
  for (let i = 0; i < 40 && (await ownerState(p)) !== RunState.AWAIT_ACTION; i++) await new Promise((r) => setTimeout(r, 500));
  check((await ownerState(p)) === RunState.AWAIT_ACTION, 'relay reveal tidak terkirim');
  check(p.txs.some((t) => t.label.startsWith('reveal') && t.relay && t.status === 'success'), 'tx relay reveal tidak tercatat');
  console.log('  ok: relay reveal otomatis setelah 150 blok (state AWAIT_ACTION)');

  // AWAIT_ACTION: refresh → encounter tersimpan
  p.stop();
  ph = await p.refreshPage();
  check(ph.kind === 'encounter' && ph.locked, `AWAIT_ACTION → ${ph.kind}`);
  await p.machine.act(safeAction(ph.encounter));
  console.log('  ok: refresh di AWAIT_ACTION → encounter tersimpan, act jalan');

  // AWAIT_SETTLE: refresh → hasil dari previewResolve
  ph = await p.refreshPage();
  if (ph.kind === 'cleared') {
    console.log('  (merchant LEAVE instan, lewati uji AWAIT_SETTLE di lantai ini)');
  } else {
    ph = await waitPhase(p, ['resolved', 'dying']);
    check(ph.kind === 'resolved', `AWAIT_SETTLE → ${ph.kind} (aksi aman tidak fatal di floor 1)`);
    console.log('  ok: refresh di AWAIT_SETTLE → hasil dari previewResolve');
    // diam ≥ 150 blok di decision modal → relay settle
    p.machine.start();
    const t2 = p.machine.snapshot!.run.targetBlock;
    await waitBlock(p.client, t2 + 152n, 'relay settle:');
    for (let i = 0; i < 40 && (await ownerState(p)) !== RunState.FLOOR_CLEARED; i++) await new Promise((r) => setTimeout(r, 500));
    check((await ownerState(p)) === RunState.FLOOR_CLEARED, 'relay settle tidak terkirim');
    console.log('  ok: relay settle otomatis setelah 150 blok (state FLOOR_CLEARED)');
    p.stop();
  }

  // FLOOR_CLEARED: refresh → decision, lalu descend dan selesaikan lantai 2
  ph = await p.refreshPage();
  check(ph.kind === 'cleared', `FLOOR_CLEARED → ${ph.kind}`);
  await p.machine.descend();
  ph = await waitPhase(p, ['encounter']);
  if (ph.kind === 'encounter') await p.machine.act(safeAction(ph.encounter));
  await finish(p);
  check((await ownerState(p)) === RunState.NONE, 'run tidak tertutup');
  console.log('  ok: refresh di FLOOR_CLEARED → decision; run selesai');
  return `${p.txs.filter((t) => t.status === 'success').length} tx sukses, ${p.txs.filter((t) => t.relay).length} relay`;
}

async function scenarioExpiry() {
  console.log('\n== tab ditutup > 256 blok (tanpa keeper) → expired → reap');
  const p = createPlayer('expiry', ownerKey);
  await ensureNoRun(p);
  await enter(p, TOPUP);
  const ph0 = await p.refreshPage();
  check(ph0.kind === 'waitReveal' || ph0.kind === 'encounter', `awal ${ph0.kind}`);
  const target = p.machine.snapshot!.run.targetBlock;
  p.stop(); // "tutup tab": tidak ada machine yang jalan
  await waitBlock(p.client, target + 258n, 'expiry:');
  const ph = await p.refreshPage();
  check(ph.kind === 'expired', `setelah window → ${ph.kind}`);
  await p.machine.reap();
  await waitPhase(p, ['noRun']);
  check((await ownerState(p)) === RunState.NONE, 'run tidak tertutup setelah reap');
  return 'fase expired terdeteksi saat load, reapExpired menutup run';
}

async function scenarioBurner() {
  console.log('\n== saldo session wallet habis');
  const p = createPlayer('burner', ownerKey); // memoryStore baru → burner baru, saldo 0
  await ensureNoRun(p);
  await enter(p, 0n); // tanpa top-up
  const ph = await waitPhase(p, ['encounter']);
  check(ph.kind === 'encounter', 'encounter');
  const rec = await p.machine.act(safeAction(ph.encounter));
  check(rec.status === 'failed', `tx tanpa saldo seharusnya failed, dapat ${rec.status}`);
  check(/insufficient|funds|balance/i.test(rec.error ?? ''), `pesan error tidak jelas: ${rec.error}`);
  check(/Top-up/.test(describeTxError(rec.error)), 'pesan UI tidak mengarahkan ke Top-up');
  console.log(`  ok: tx gagal sebelum masuk chain: "${rec.error?.slice(0, 70)}"`);
  // top-up dari main wallet (tombol Top-up di UI) lalu lanjut
  const w = createWalletClient({ account: p.owner, chain: activeChain, transport: transportFor() });
  const h = await w.sendTransaction({ to: p.session.address, value: parseEther('0.05') });
  await p.client.waitForTransactionReceipt({ hash: h });
  const ph2 = await p.refreshPage();
  check(ph2.kind === 'encounter', `setelah top-up ${ph2.kind}`);
  const rec2 = await p.machine.act(safeAction(ph2.encounter));
  check(rec2.status === 'success', `act setelah top-up ${rec2.status}`);
  await finish(p);
  return 'tx gagal dengan pesan saldo kurang (tidak ada gas terbuang), lanjut normal setelah top-up';
}

async function scenarioRpc() {
  console.log('\n== RPC utama mati → fallback');
  const transport = fallback(
    [http('https://rpc.invalid.depths.example', { retryCount: 0, timeout: 3_000 }), ...rpcUrls().map((u) => http(u))],
    { shouldThrow: rpcShouldThrow },
  );
  const client = createDepthsClient(undefined, transport);
  const p = createPlayer('rpc', ownerKey, { client });
  await ensureNoRun(p);
  await enter(p, TOPUP);
  const ph = await waitPhase(p, ['encounter']);
  if (ph.kind === 'encounter') await p.machine.act(safeAction(ph.encounter));
  await finish(p);
  check(p.txs.every((t) => t.status === 'success'), 'ada tx gagal lewat fallback');
  return `${p.txs.length} tx sukses lewat RPC cadangan`;
}

const SCENARIOS: Record<string, () => Promise<string>> = {
  refresh: scenarioRefresh,
  expiry: scenarioExpiry,
  burner: scenarioBurner,
  rpc: scenarioRpc,
};

async function main() {
  const arg = process.argv[2] ?? 'all';
  const names = arg === 'all' ? Object.keys(SCENARIOS) : [arg];
  for (const n of names) {
    const fn = SCENARIOS[n];
    if (!fn) throw new Error(`skenario tidak dikenal: ${n}`);
    try {
      results.push({ name: n, ok: true, note: await fn() });
    } catch (e) {
      results.push({ name: n, ok: false, note: (e as Error).message });
      console.error(e);
    }
  }
  console.log('\n| Skenario | Hasil | Catatan |\n|---|---|---|');
  for (const r of results) console.log(`| ${r.name} | ${r.ok ? 'OK' : 'GAGAL'} | ${r.note} |`);
  stopAll();
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

void main();
