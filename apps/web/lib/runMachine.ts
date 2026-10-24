import { encodeFunctionData, type Address, type Chain, type Hex, type PublicClient, type Transport } from 'viem';
import {
  Action,
  Encounter,
  MAX_FLOOR,
  RunState,
  replayCombat,
  type Replay,
  type ReplayKind,
  type Resolution,
} from 'game-logic';
import {
  BLOCKHASH_WINDOW,
  MAX_AWARD_BPS,
  depthsAbi,
  type OnchainRun,
  type PoolInfo,
} from './contracts';
import { gasFromEstimate, gasLimit, WORST_CASE_GAS, type GasPath } from './gas';
import type { TxQueue, TxRecord } from './txQueue';

// Map Run on-chain → fase UI, dan penggerak jalur 2 tx per lantai (ARCHITECTURE §4.2.1, §6):
//   act  → tunggu block > targetBlock → previewResolve → keputusan → descend / cashOut
// Fallback relay reveal/settle kalau player diam ≥ 150 blok. Kematian di preview langsung di-settle
// supaya run tertutup (enterDungeon berikutnya butuh state NONE).

/** Frontend relay di 150 blok setelah targetBlock (keeper di 200). */
export const RELAY_AFTER_BLOCKS = 150n;
const ZERO_SEED = `0x${'0'.repeat(64)}` as const;

export interface Snapshot {
  block: bigint;
  run: OnchainRun;
  pool: PoolInfo;
  encounter: { enc: number; monsterId: number; ready: boolean; expired: boolean };
  resolve: { res: Resolution; seed: Hex; ready: boolean; expired: boolean };
}

export type Phase =
  | { kind: 'noRun' }
  | { kind: 'waitReveal'; blocksLeft: number }
  | { kind: 'encounter'; encounter: Encounter; monsterId: number; locked: boolean }
  | { kind: 'waitResolve'; blocksLeft: number }
  | { kind: 'resolved'; resolution: Resolution; seed: Hex; award: bigint; replay: Replay | null }
  | { kind: 'dying'; resolution: Resolution; seed: Hex; replay: Replay | null }
  | { kind: 'cleared' }
  | { kind: 'expired' };

export async function readSnapshot(
  client: PublicClient<Transport, Chain>,
  address: Address,
  owner: Address,
): Promise<Snapshot> {
  const c = { address, abi: depthsAbi } as const;
  // Satu multicall (viem batch) kalau chain punya multicall3; block number dibaca di request yang sama.
  const [block, run, pool, enc, res] = await Promise.all([
    client.getBlockNumber({ cacheTime: 0 }),
    client.readContract({ ...c, functionName: 'getRun', args: [owner] }),
    client.readContract({ ...c, functionName: 'poolInfo' }),
    client.readContract({ ...c, functionName: 'previewEncounter', args: [owner] }),
    client.readContract({ ...c, functionName: 'previewResolve', args: [owner] }),
  ]);
  const [r, seed, rReady, rExpired] = res;
  return {
    block,
    run,
    pool,
    encounter: { enc: enc[0], monsterId: enc[1], ready: enc[2], expired: enc[3] },
    resolve: {
      res: {
        outcome: r.outcome as Resolution['outcome'],
        survived: r.survived,
        hpAfter: r.hpAfter,
        lootTable: r.lootTable,
        bagLoss: r.bagLoss,
      },
      seed,
      ready: rReady,
      expired: rExpired,
    },
  };
}

/** Award setelah cap 5% pool (CONTRACT_SPEC §4), sama dengan perhitungan `_settle`. */
export function cappedAward(lootTable: bigint, pool: bigint): bigint {
  const cap = (pool * MAX_AWARD_BPS) / 10_000n;
  return lootTable < cap ? lootTable : cap;
}

export function replayKind(action: number): ReplayKind | null {
  if (action === Action.FIGHT) return 'fight';
  if (action === Action.FLEE) return 'flee';
  if (action === Action.OPEN) return 'open';
  return null;
}

/** Timeline combat untuk aksi pending (null untuk trap). Draw identik dengan resolusi on-chain. */
export function replayFor(run: OnchainRun, seed: Hex): Replay | null {
  const kind = replayKind(run.pendingAction);
  if (!kind) return null;
  return replayCombat({ seed, kind, floor: run.floor, hp: run.hp, maxHp: run.maxHp, atk: run.atk, usePotion: run.usePotion });
}

/** Jumlah serangan (draw combat) di replay, untuk gas limit. */
export function attackCount(replay: Replay | null): number {
  return replay ? replay.events.filter((e) => e.type === 'playerHit' || e.type === 'monsterHit').length : 0;
}

function isExpired(run: OnchainRun, block: bigint): boolean {
  return block > run.targetBlock + BLOCKHASH_WINDOW;
}

/** Fase UI dari snapshot (pure). */
export function derivePhase(s: Snapshot): Phase {
  const { run, block } = s;
  switch (run.state) {
    case RunState.AWAIT_REVEAL: {
      if (isExpired(run, block)) return { kind: 'expired' };
      if (block <= run.targetBlock) return { kind: 'waitReveal', blocksLeft: Number(run.targetBlock - block + 1n) };
      return { kind: 'encounter', encounter: s.encounter.enc as Encounter, monsterId: s.encounter.monsterId, locked: false };
    }
    case RunState.AWAIT_ACTION:
      return { kind: 'encounter', encounter: run.encounter as Encounter, monsterId: run.monsterId, locked: true };
    case RunState.AWAIT_SETTLE: {
      if (isExpired(run, block)) return { kind: 'expired' };
      if (block <= run.targetBlock) return { kind: 'waitResolve', blocksLeft: Number(run.targetBlock - block + 1n) };
      const { res, seed } = s.resolve;
      const replay = replayFor(run, seed);
      if (!res.survived) return { kind: 'dying', resolution: res, seed, replay };
      return { kind: 'resolved', resolution: res, seed, award: cappedAward(res.lootTable, s.pool[0]), replay };
    }
    case RunState.FLOOR_CLEARED:
      return { kind: 'cleared' };
    default:
      return { kind: 'noRun' };
  }
}

/** Relay fallback yang perlu dikirim sekarang (≥ 150 blok sejak target, belum expired), atau null. */
export function relayNeeded(s: Snapshot, after: bigint = RELAY_AFTER_BLOCKS): 'reveal' | 'settle' | null {
  const { run, block } = s;
  if (run.state !== RunState.AWAIT_REVEAL && run.state !== RunState.AWAIT_SETTLE) return null;
  if (isExpired(run, block) || block < run.targetBlock + after) return null;
  return run.state === RunState.AWAIT_REVEAL ? 'reveal' : 'settle';
}

export function isInstant(action: number): boolean {
  return action === Action.LEAVE || action === Action.BUY;
}

/** Path gas untuk `act` di state saat ini. */
export function actGasPath(state: number, action: number): GasPath {
  const reveal = state === RunState.AWAIT_REVEAL;
  if (action === Action.BUY) return reveal ? 'actRevealBuy' : 'actBuy';
  if (action === Action.LEAVE) return reveal ? 'actRevealLeave' : 'actLeave';
  return reveal ? 'actRevealCommit' : 'actCommit';
}

export interface Purchase {
  swords: number;
  shields: number;
  potions: number;
}

export interface RunMachineOptions {
  client: PublicClient<Transport, Chain>;
  address: Address;
  owner: Address;
  queue: TxQueue;
  onSnapshot?: (s: Snapshot, phase: Phase) => void;
  onError?: (msg: string) => void;
  relayAfter?: bigint;
  /** Interval polling blok (ms). */
  pollMs?: number;
}

/**
 * Penggerak run untuk satu owner. Semua tx in-run lewat `queue` (session wallet).
 * `enterDungeon` tidak di sini: itu satu-satunya popup main wallet.
 */
export class RunMachine {
  private snap: Snapshot | null = null;
  private phase: Phase = { kind: 'noRun' };
  private unwatch: (() => void) | null = null;
  private refreshing: Promise<void> | null = null;
  private lastBlock = 0n;
  /** Tx keputusan player sedang berjalan; relay ditahan supaya tidak balapan. */
  private busy = false;
  /** Kunci relay/auto-settle per (runId, floor, state, target) supaya tidak terkirim dua kali. */
  private sentAuto = new Set<string>();

  constructor(private readonly opts: RunMachineOptions) {}

  get snapshot(): Snapshot | null {
    return this.snap;
  }

  get current(): Phase {
    return this.phase;
  }

  start(): void {
    if (this.unwatch) return;
    this.unwatch = this.opts.client.watchBlockNumber({
      poll: true,
      pollingInterval: this.opts.pollMs ?? 250,
      emitMissed: false,
      onBlockNumber: (b) => void this.onBlock(b),
      onError: (e) => this.opts.onError?.(e.message),
    });
    void this.refresh();
  }

  stop(): void {
    this.unwatch?.();
    this.unwatch = null;
  }

  /** Baca ulang state dari chain (recovery saat load, setelah tx, atau saat blok target lewat). */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const s = await readSnapshot(this.opts.client, this.opts.address, this.opts.owner);
        this.snap = s;
        this.lastBlock = s.block;
        this.phase = derivePhase(s);
        this.opts.onSnapshot?.(s, this.phase);
        void this.autoActions();
      } catch (e) {
        this.opts.onError?.((e as Error).message);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async onBlock(b: bigint): Promise<void> {
    if (b <= this.lastBlock) return;
    const s = this.snap;
    this.lastBlock = b;
    if (!s) return void this.refresh();
    const waiting = this.phase.kind === 'waitReveal' || this.phase.kind === 'waitResolve';
    const pending = s.run.state === RunState.AWAIT_REVEAL || s.run.state === RunState.AWAIT_SETTLE;
    // Saat menunggu blok target: refresh begitu block > target. Saat menunggu keputusan player: refresh
    // tiap 25 blok (pool + countdown relay), dan tepat saat ambang relay tercapai.
    if (waiting && b > s.run.targetBlock) return void this.refresh();
    if (pending && b >= s.run.targetBlock + (this.opts.relayAfter ?? RELAY_AFTER_BLOCKS)) return void this.refresh();
    if (b - s.block >= 25n) return void this.refresh();
  }

  private autoKey(s: Snapshot, what: string): string {
    return `${s.run.runId}:${s.run.floor}:${s.run.state}:${s.run.targetBlock}:${what}`;
  }

  /** Relay fallback dan settle kematian, dikirim otomatis tanpa input player. */
  private async autoActions(): Promise<void> {
    const s = this.snap;
    if (!s || this.busy) return;
    if (this.phase.kind === 'dying') {
      const key = this.autoKey(s, 'death');
      if (this.sentAuto.has(key)) return;
      this.sentAuto.add(key);
      await this.send({ label: 'settle (mati)', data: this.encodeOwner('settle'), relay: true });
      return;
    }
    const relay = relayNeeded(s, this.opts.relayAfter);
    if (!relay) return;
    const key = this.autoKey(s, relay);
    if (this.sentAuto.has(key)) return;
    this.sentAuto.add(key);
    if (relay === 'reveal') {
      const gas = gasLimit({ path: 'reveal', firstReveal: s.run.encounterSeed === ZERO_SEED });
      await this.send({ label: 'reveal (relay)', data: this.encodeOwner('reveal'), gas, relay: true });
    } else {
      const res = s.resolve.res;
      const estimate = !res.survived || s.run.floor === MAX_FLOOR; // kematian / auto cash out: board
      const gas = estimate
        ? undefined
        : gasLimit({ path: 'settle', attacks: attackCount(replayFor(s.run, s.resolve.seed)), poolChange: this.poolChange(res) });
      await this.send({ label: 'settle (relay)', data: this.encodeOwner('settle'), gas, relay: true });
    }
  }

  // ------------------------------------------------------------------ aksi player

  /** Pilih aksi untuk encounter. Di AWAIT_REVEAL, contract me-reveal dulu di tx yang sama. */
  async act(action: number, usePotion = false, buy: Purchase = { swords: 0, shields: 0, potions: 0 }): Promise<TxRecord> {
    const s = this.requireSnap();
    const firstReveal = s.run.state === RunState.AWAIT_REVEAL && s.run.encounterSeed === ZERO_SEED;
    const gas = gasLimit({ path: actGasPath(s.run.state, action), firstReveal });
    const q = action === Action.BUY ? buy : { swords: 0, shields: 0, potions: 0 };
    return this.decide({
      label: `act ${actionName(action)}`,
      data: encodeFunctionData({
        abi: depthsAbi,
        functionName: 'act',
        args: [action, q.swords, q.shields, q.potions, usePotion],
      }),
      gas,
    });
  }

  /** GO DEEPER. Di AWAIT_SETTLE, contract men-settle hasil lantai ini dulu. */
  async descend(): Promise<TxRecord> {
    const s = this.requireSnap();
    let gas: bigint;
    if (s.run.state === RunState.AWAIT_SETTLE) {
      const res = s.resolve.res;
      gas = gasLimit({
        path: 'descendSettle',
        attacks: attackCount(replayFor(s.run, s.resolve.seed)),
        poolChange: this.poolChange(res),
      });
    } else {
      gas = gasLimit({ path: 'descendCleared' });
    }
    return this.decide({ label: 'descend', data: encodeFunctionData({ abi: depthsAbi, functionName: 'descend' }), gas });
  }

  /** CASH OUT. Biaya board bergantung posisi insert, jadi pakai eth_estimateGas. Bag selalu ke owner. */
  async cashOut(): Promise<TxRecord> {
    this.requireSnap();
    return this.decide({ label: 'cashOut', data: encodeFunctionData({ abi: depthsAbi, functionName: 'cashOut' }) });
  }

  /** Tutup run yang expired (lewat window 256 blok) supaya owner bisa masuk lagi. */
  async reap(): Promise<TxRecord> {
    this.requireSnap();
    return this.decide({
      label: 'reapExpired',
      data: encodeFunctionData({ abi: depthsAbi, functionName: 'reapExpired', args: [this.opts.owner] }),
    });
  }

  // ------------------------------------------------------------------ internal

  private requireSnap(): Snapshot {
    if (!this.snap) throw new Error('state run belum dibaca');
    return this.snap;
  }

  private poolChange(res: Resolution): boolean {
    return res.lootTable > 0n || res.bagLoss > 0n;
  }

  private encodeOwner(functionName: 'reveal' | 'settle'): Hex {
    return encodeFunctionData({ abi: depthsAbi, functionName, args: [this.opts.owner] });
  }

  private async estimate(data: Hex): Promise<bigint> {
    try {
      const est = await this.opts.client.estimateGas({ account: this.opts.queue.sender, to: this.opts.address, data });
      return gasFromEstimate(est);
    } catch {
      return WORST_CASE_GAS;
    }
  }

  private async decide(req: SendReq): Promise<TxRecord> {
    this.busy = true;
    try {
      return await this.send(req);
    } finally {
      this.busy = false;
    }
  }

  private async send(req: SendReq): Promise<TxRecord> {
    const gas = req.gas ?? (await this.estimate(req.data));
    const rec = await this.opts.queue.enqueue({
      label: req.label,
      data: req.data,
      gas,
      relay: req.relay,
      retryGas: async (used) => {
        const next = await this.estimate(req.data);
        return next > used ? next : null;
      },
    });
    if (rec.status !== 'success') this.opts.onError?.(`${req.label}: ${rec.error ?? 'revert'} (re-sync dari chain)`);
    await this.refresh();
    return rec;
  }
}

interface SendReq {
  label: string;
  data: Hex;
  /** undefined = pakai eth_estimateGas (jalur yang biayanya bergantung board). */
  gas?: bigint;
  relay?: boolean;
}

export function actionName(action: number): string {
  const entry = Object.entries(Action).find(([, v]) => v === action);
  return entry ? entry[0] : String(action);
}

/** Aksi valid per encounter (CONTRACT_SPEC §4). */
export function validActions(enc: number): number[] {
  switch (enc) {
    case Encounter.MONSTER:
      return [Action.FIGHT, Action.FLEE];
    case Encounter.TREASURE:
      return [Action.OPEN, Action.LEAVE];
    case Encounter.TRAP:
      return [Action.PROCEED, Action.DISARM];
    case Encounter.MERCHANT:
      return [Action.BUY, Action.LEAVE];
    default:
      return [];
  }
}
