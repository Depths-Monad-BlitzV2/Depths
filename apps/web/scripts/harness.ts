// Helper bersama scripts/edge.ts dan scripts/playtest.ts: pemain headless yang memakai lib/* yang sama
// dengan /play (session, TxQueue, RunMachine). "Refresh" = buang machine + queue, buat ulang dari chain.

import { createWalletClient, isHex, type Address, type Chain, type Hex, type PublicClient, type Transport } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { Action, Encounter } from 'game-logic';
import { activeChain, transportFor } from '../lib/chains';
import { createDepthsClient } from '../lib/client';
import { depthsAbi, depthsAddress } from '../lib/contracts';
import { RunMachine, type Phase } from '../lib/runMachine';
import { loadOrCreateSession, memoryStore, sessionStorageKey, type KeyValueStore } from '../lib/session';
import { TxQueue, type TxRecord } from '../lib/txQueue';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function keyFromEnv(name: string): Hex {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`set ${name}`);
  const k = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex;
  if (!isHex(k) || k.length !== 66) throw new Error(`${name} bukan private key`);
  return k;
}

export interface Player {
  label: string;
  owner: PrivateKeyAccount;
  session: PrivateKeyAccount;
  client: PublicClient<Transport, Chain>;
  address: Address;
  txs: TxRecord[];
  machine: RunMachine;
  phase: Phase;
  /** Buang machine/queue dan buat ulang dari chain (= refresh halaman). */
  refreshPage(): Promise<Phase>;
  stop(): void;
}

export function createPlayer(
  label: string,
  ownerKey: Hex,
  opts: { store?: KeyValueStore; client?: PublicClient<Transport, Chain>; watch?: boolean; log?: boolean } = {},
): Player {
  const client = opts.client ?? createDepthsClient();
  const owner = privateKeyToAccount(ownerKey);
  const store = opts.store ?? memoryStore();
  const { account: session } = loadOrCreateSession(owner.address, store);
  const address = depthsAddress();
  const txs: TxRecord[] = [];

  const build = () => {
    const queue = new TxQueue({
      client,
      account: session,
      address,
      onUpdate: (r) => {
        const i = txs.findIndex((t) => t.id === r.id && t.label === r.label);
        if (i === -1) txs.push(r);
        else txs[i] = r;
        if (opts.log !== false && (r.status === 'success' || r.status === 'reverted' || r.status === 'failed')) {
          console.log(`  [${label}] tx ${r.label.padEnd(18)} ${r.status.padEnd(8)} ${r.latencyMs ?? '-'}ms${r.relay ? ' [relay]' : ''}${r.error ? ` ${r.error.slice(0, 80)}` : ''}`);
        }
      },
    });
    const m = new RunMachine({
      client,
      address,
      owner: owner.address,
      queue,
      onSnapshot: (_s, p) => (player.phase = p),
      onError: (msg) => opts.log !== false && console.log(`  [${label}] ! ${msg.slice(0, 120)}`),
    });
    if (opts.watch) m.start();
    return m;
  };

  const player: Player = {
    label,
    owner,
    session,
    client,
    address,
    txs,
    machine: undefined as unknown as RunMachine,
    phase: { kind: 'noRun' },
    async refreshPage() {
      player.machine.stop();
      player.machine = build();
      await player.machine.refresh();
      return player.phase;
    },
    stop() {
      player.machine.stop();
    },
  };
  player.machine = build();
  players.push(player);
  return player;
}

/** Refresh berulang sampai fase salah satu `kinds`. */
export async function waitPhase(p: Player, kinds: Phase['kind'][], timeoutMs = 120_000): Promise<Phase> {
  const t0 = Date.now();
  for (;;) {
    await p.machine.refresh();
    if (kinds.includes(p.phase.kind)) return p.phase;
    if (Date.now() - t0 > timeoutMs) throw new Error(`[${p.label}] timeout menunggu ${kinds.join('/')}, fase ${p.phase.kind}`);
    await sleep(300);
  }
}

/** Tunggu sampai block.number melewati `target`. */
export async function waitBlock(client: PublicClient<Transport, Chain>, target: bigint, label = ''): Promise<void> {
  let last = 0n;
  for (;;) {
    const b = await client.getBlockNumber({ cacheTime: 0 });
    if (b > target) return;
    if (b - last >= 50n) {
      console.log(`  ${label} blok ${b}, tunggu sampai > ${target} (${target - b} lagi)`);
      last = b;
    }
    await sleep(1_000);
  }
}

/** Satu-satunya tx main wallet (= popup di UI): enterDungeon(session) dengan fee + top-up. */
export async function enter(p: Player, topUp: bigint): Promise<void> {
  const wallet = createWalletClient({ account: p.owner, chain: activeChain, transport: transportFor() });
  const [, , , fee] = await p.client.readContract({ address: p.address, abi: depthsAbi, functionName: 'poolInfo' });
  const hash = await wallet.writeContract({
    address: p.address,
    abi: depthsAbi,
    functionName: 'enterDungeon',
    args: [p.session.address],
    value: fee + topUp,
  });
  const rc = await p.client.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`[${p.label}] enterDungeon revert`);
}

/** Aksi aman: FIGHT, OPEN, PROCEED (tidak pernah fatal), LEAVE. */
export function safeAction(enc: number): number {
  if (enc === Encounter.MONSTER) return Action.FIGHT;
  if (enc === Encounter.TREASURE) return Action.OPEN;
  if (enc === Encounter.TRAP) return Action.PROCEED;
  return Action.LEAVE;
}

/**
 * Tutup run owner yang tertinggal (mis. skenario sebelumnya gagal dan key burner-nya hilang): owner
 * sendiri menjadi penanda tangan, karena owner selalu boleh mengontrol run-nya.
 */
export async function cleanupRun(ownerKey: Hex, label = 'cleanup'): Promise<void> {
  const store = memoryStore();
  store.setItem(sessionStorageKey(privateKeyToAccount(ownerKey).address), ownerKey);
  const p = createPlayer(label, ownerKey, { store });
  try {
    for (let i = 0; i < 20; i++) {
      const ph = await p.refreshPage();
      if (ph.kind === 'noRun') return;
      if (ph.kind === 'expired') await p.machine.reap();
      else if (ph.kind === 'encounter') await p.machine.act(safeAction(ph.encounter));
      else if (ph.kind === 'resolved' || ph.kind === 'cleared') await p.machine.cashOut();
      else await sleep(1_000); // waitReveal / waitResolve / dying (auto-settle jalan saat refresh)
    }
    throw new Error(`[${label}] run tidak bisa ditutup`);
  } finally {
    p.stop();
  }
}

const players: Player[] = [];
/** Hentikan semua polling sebelum proses keluar. */
export function stopAll(): void {
  players.forEach((p) => p.stop());
}

export async function ownerState(p: Player): Promise<number> {
  return (await p.client.readContract({ address: p.address, abi: depthsAbi, functionName: 'getRun', args: [p.owner.address] })).state;
}
