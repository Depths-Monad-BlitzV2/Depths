import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { Action, Encounter, Outcome, RunState, type Resolution } from 'game-logic';
import { GAS_BASE, GAS_FIRST_REVEAL, GAS_PER_ATTACK, GAS_POOL_CHANGE, WORST_CASE_GAS, gasFromEstimate, gasLimit, withMargin } from '../lib/gas';
import { mon } from '../lib/log';
import {
  actGasPath,
  attackCount,
  cappedAward,
  derivePhase,
  relayNeeded,
  replayFor,
  validActions,
  type Snapshot,
} from '../lib/runMachine';
import { loadOrCreateSession, memoryStore, sessionStorageKey } from '../lib/session';
import { Narrator, type RunEnd } from '../lib/narrator';
import { describeTxError } from '../lib/txQueue';
import { rpcShouldThrow } from '../lib/chains';
import type { OnchainRun } from '../lib/contracts';

const ZERO: Hex = `0x${'0'.repeat(64)}`;
const SEED: Hex = `0x${'ab'.repeat(32)}`;
const OWNER = '0x5219fFbF9A44F96A8931A50A31021E4724518735' as const;

function run(over: Partial<OnchainRun> = {}): OnchainRun {
  return {
    operator: OWNER,
    runId: 1,
    state: RunState.AWAIT_REVEAL,
    floor: 3,
    encounter: 0,
    pendingAction: 0,
    swords: 0,
    shields: 0,
    potions: 0,
    usePotion: false,
    hp: 80,
    maxHp: 100,
    atk: 12,
    monsterId: 0,
    targetBlock: 1_000n,
    bag: 0n,
    encounterSeed: ZERO,
    ...over,
  };
}

const RES_WIN: Resolution = { outcome: Outcome.WIN, survived: true, hpAfter: 60, lootTable: 4n * 10n ** 17n, bagLoss: 0n };

function snap(r: OnchainRun, block: bigint, over: Partial<Snapshot> = {}): Snapshot {
  return {
    block,
    run: r,
    pool: [100n * 10n ** 18n, 0n, 0n, 10n ** 18n],
    encounter: { enc: Encounter.MONSTER, monsterId: 2, ready: block > r.targetBlock, expired: false },
    resolve: { res: RES_WIN, seed: SEED, ready: block > r.targetBlock, expired: false },
    ...over,
  };
}

describe('gas', () => {
  it('base + serangan + pool change + reveal pertama, dengan margin 20%', () => {
    expect(gasLimit({ path: 'descendSettle' })).toBe(withMargin(GAS_BASE.descendSettle));
    const expected = withMargin(GAS_BASE.descendSettle + 11n * GAS_PER_ATTACK + GAS_POOL_CHANGE);
    expect(gasLimit({ path: 'descendSettle', attacks: 11, poolChange: true })).toBe(expected);
    expect(gasLimit({ path: 'actRevealCommit', firstReveal: true })).toBe(
      withMargin(GAS_BASE.actRevealCommit + GAS_FIRST_REVEAL),
    );
  });

  it('kalibrasi testnet Phase 3 tercakup (estimate ≤ limit)', () => {
    // CONTRACT_SPEC §8: cast estimate di Monad testnet
    expect(gasLimit({ path: 'actRevealCommit' })).toBeGreaterThanOrEqual(52_947n);
    expect(gasLimit({ path: 'actRevealLeave', firstReveal: true })).toBeGreaterThanOrEqual(72_648n);
    expect(gasLimit({ path: 'descendCleared' })).toBeGreaterThanOrEqual(45_084n);
    expect(gasLimit({ path: 'reveal' })).toBeGreaterThanOrEqual(39_075n);
    expect(gasLimit({ path: 'settle', attacks: 11, poolChange: true })).toBeGreaterThanOrEqual(62_534n);
    expect(gasLimit({ path: 'actCommit' })).toBeGreaterThanOrEqual(47_668n);
  });

  it('dibatasi worst case', () => {
    expect(gasLimit({ path: 'descendSettle', attacks: 10_000 })).toBe(WORST_CASE_GAS);
    expect(gasFromEstimate(100_000n)).toBe(120_000n);
    expect(gasFromEstimate(1_000_000n)).toBe(WORST_CASE_GAS);
  });
});

describe('derivePhase', () => {
  it('NONE → noRun', () => {
    expect(derivePhase(snap(run({ state: RunState.NONE }), 1_000n)).kind).toBe('noRun');
  });

  it('AWAIT_REVEAL: tunggu sampai block > target, lalu encounter dari preview', () => {
    expect(derivePhase(snap(run(), 1_000n))).toEqual({ kind: 'waitReveal', blocksLeft: 1 });
    expect(derivePhase(snap(run(), 1_001n))).toMatchObject({ kind: 'encounter', encounter: Encounter.MONSTER, locked: false });
  });

  it('AWAIT_ACTION memakai encounter tersimpan', () => {
    const p = derivePhase(snap(run({ state: RunState.AWAIT_ACTION, encounter: Encounter.TRAP, monsterId: 1 }), 5_000n));
    expect(p).toEqual({ kind: 'encounter', encounter: Encounter.TRAP, monsterId: 1, locked: true });
  });

  it('AWAIT_SETTLE: resolved dengan award ter-cap, atau dying', () => {
    const r = run({ state: RunState.AWAIT_SETTLE, pendingAction: Action.FIGHT });
    const p = derivePhase(snap(r, 1_001n));
    expect(p.kind).toBe('resolved');
    if (p.kind === 'resolved') expect(p.award).toBe(RES_WIN.lootTable);
    const thin = derivePhase(snap(r, 1_001n, { pool: [10n ** 18n, 0n, 0n, 10n ** 18n] }));
    if (thin.kind === 'resolved') expect(thin.award).toBe(5n * 10n ** 16n);
    const dead: Resolution = { outcome: Outcome.KILLED, survived: false, hpAfter: 0, lootTable: 0n, bagLoss: 0n };
    const s = snap(r, 1_001n);
    expect(derivePhase({ ...s, resolve: { ...s.resolve, res: dead } }).kind).toBe('dying');
  });

  it('expired lewat window 256 blok', () => {
    expect(derivePhase(snap(run(), 1_256n)).kind).toBe('encounter');
    expect(derivePhase(snap(run(), 1_257n)).kind).toBe('expired');
    expect(derivePhase(snap(run({ state: RunState.AWAIT_SETTLE }), 1_257n)).kind).toBe('expired');
  });

  it('FLOOR_CLEARED → cleared (tanpa expiry)', () => {
    expect(derivePhase(snap(run({ state: RunState.FLOOR_CLEARED }), 99_999n)).kind).toBe('cleared');
  });
});

describe('relayNeeded', () => {
  it('relay di ≥ 150 blok setelah target, sebelum expiry', () => {
    expect(relayNeeded(snap(run(), 1_149n))).toBeNull();
    expect(relayNeeded(snap(run(), 1_150n))).toBe('reveal');
    expect(relayNeeded(snap(run({ state: RunState.AWAIT_SETTLE }), 1_200n))).toBe('settle');
    expect(relayNeeded(snap(run(), 1_257n))).toBeNull();
    expect(relayNeeded(snap(run({ state: RunState.AWAIT_ACTION }), 5_000n))).toBeNull();
  });
});

describe('helpers', () => {
  it('cappedAward = min(tabel, 5% pool)', () => {
    expect(cappedAward(10n, 1_000n)).toBe(10n);
    expect(cappedAward(100n, 1_000n)).toBe(50n);
  });

  it('actGasPath per state dan aksi', () => {
    expect(actGasPath(RunState.AWAIT_REVEAL, Action.FIGHT)).toBe('actRevealCommit');
    expect(actGasPath(RunState.AWAIT_REVEAL, Action.BUY)).toBe('actRevealBuy');
    expect(actGasPath(RunState.AWAIT_ACTION, Action.LEAVE)).toBe('actLeave');
  });

  it('validActions sesuai CONTRACT_SPEC §4', () => {
    expect(validActions(Encounter.MONSTER)).toEqual([Action.FIGHT, Action.FLEE]);
    expect(validActions(Encounter.MERCHANT)).toEqual([Action.BUY, Action.LEAVE]);
  });

  it('replayFor + attackCount: trap tanpa replay, fight punya serangan', () => {
    expect(replayFor(run({ pendingAction: Action.PROCEED }), SEED)).toBeNull();
    const rp = replayFor(run({ pendingAction: Action.FIGHT, floor: 1 }), SEED);
    expect(rp).not.toBeNull();
    expect(attackCount(rp)).toBeGreaterThan(0);
  });

  it('mon: 3 desimal', () => {
    expect(mon(10n ** 18n)).toBe('1.000');
    expect(mon(1_234_567n * 10n ** 12n)).toBe('1.234');
    expect(mon(5n * 10n ** 16n)).toBe('0.050');
  });
});

describe('Narrator', () => {
  function collect() {
    const lines: string[] = [];
    const ends: RunEnd[] = [];
    const n = new Narrator({ log: (t) => lines.push(t), ended: (e) => ends.push(e) });
    return { n, lines, ends };
  }
  const none = run({ state: RunState.NONE, runId: 0, floor: 0 });

  it('encounter dan hasil dinarasikan sekali walau snapshot berulang', () => {
    const { n, lines } = collect();
    const s1 = snap(run(), 1_001n);
    n.push(s1, derivePhase(s1));
    n.push(s1, derivePhase(s1));
    expect(lines.filter((l) => l.startsWith('Lantai 3.'))).toHaveLength(1);
    const s2 = snap(run({ state: RunState.AWAIT_SETTLE, pendingAction: Action.PROCEED }), 1_001n);
    n.push(s2, derivePhase(s2));
    n.push(s2, derivePhase(s2));
    expect(lines.filter((l) => l.startsWith('Menang'))).toHaveLength(1);
  });

  it('cash out dari AWAIT_SETTLE: bag + award − bagLoss', () => {
    const { n, ends } = collect();
    const s = snap(run({ state: RunState.AWAIT_SETTLE, pendingAction: Action.FIGHT, bag: 10n ** 18n }), 1_001n);
    n.push(s, derivePhase(s));
    n.push(snap(none, 1_010n), { kind: 'noRun' });
    expect(ends).toEqual([{ kind: 'cashOut', floor: 3, amount: 10n ** 18n + RES_WIN.lootTable }]);
  });

  it('mati dan expired', () => {
    const dead: Resolution = { outcome: Outcome.KILLED, survived: false, hpAfter: 0, lootTable: 0n, bagLoss: 0n };
    const a = collect();
    const s = snap(run({ state: RunState.AWAIT_SETTLE, pendingAction: Action.FIGHT, bag: 7n }), 1_001n);
    const sd = { ...s, resolve: { ...s.resolve, res: dead } };
    a.n.push(sd, derivePhase(sd));
    a.n.push(snap(none, 1_010n), { kind: 'noRun' });
    expect(a.ends).toEqual([{ kind: 'death', floor: 3, amount: 7n }]);

    const b = collect();
    const se = snap(run({ bag: 3n }), 1_300n);
    b.n.push(se, derivePhase(se));
    b.n.push(snap(none, 1_301n), { kind: 'noRun' });
    expect(b.ends[0]?.kind).toBe('expired');
  });
});

describe('session', () => {
  it('burner per owner disimpan dan dipakai ulang', () => {
    const store = memoryStore();
    const a = loadOrCreateSession(OWNER, store);
    expect(a.created).toBe(true);
    expect(store.getItem(sessionStorageKey(OWNER))).toMatch(/^0x[0-9a-f]{64}$/);
    const b = loadOrCreateSession(OWNER, store);
    expect(b.created).toBe(false);
    expect(b.account.address).toBe(a.account.address);
    const other = loadOrCreateSession('0x0000000000000000000000000000000000000001', store);
    expect(other.account.address).not.toBe(a.account.address);
  });
});

describe('error tx dan fallback RPC (Phase 6)', () => {
  it('describeTxError: saldo kurang diarahkan ke Top-up', () => {
    expect(describeTxError('Signer had insufficient balance')).toContain('Top-up');
    expect(describeTxError('insufficient funds for gas * price + value')).toContain('Top-up');
    expect(describeTxError('Signer had insufficient balance', 'wallet')).toContain('wallet utama');
    expect(describeTxError('nonce too low')).toContain('Urutan transaksi');
    expect(describeTxError('fetch failed')).toContain('Koneksi');
    expect(describeTxError('execution reverted: X')).toBe('execution reverted: X');
    expect(describeTxError(undefined)).toBe('Transaksi gagal.');
  });

  it('rpcShouldThrow: error semantik tidak di-fallback, error jaringan/kapasitas di-fallback', () => {
    const withCode = (code: number) => Object.assign(new Error('x'), { code });
    expect(rpcShouldThrow(withCode(-32602))).toBe(true); // invalid params / saldo kurang
    expect(rpcShouldThrow(withCode(-32000))).toBe(true); // invalid input
    expect(rpcShouldThrow(withCode(3))).toBe(true); // execution reverted
    expect(rpcShouldThrow(withCode(-32005))).toBe(false); // rate limit
    expect(rpcShouldThrow(withCode(-32601))).toBe(false); // method tidak tersedia
    expect(rpcShouldThrow(withCode(-32603))).toBe(false); // internal error
    expect(rpcShouldThrow(new Error('fetch failed'))).toBe(false); // jaringan
  });
});
