// Keputusan keeper (pure, tanpa I/O) supaya bisa dites. Lihat ARCHITECTURE §4.2.1.

export const RunState = {
  NONE: 0,
  AWAIT_REVEAL: 1,
  AWAIT_ACTION: 2,
  AWAIT_SETTLE: 3,
  FLOOR_CLEARED: 4,
} as const;

export const MAX_FLOOR = 20;
/** Window blockhash; lewat dari ini run dianggap mati (CONTRACT_SPEC §4). */
export const BLOCKHASH_WINDOW = 256n;
/** Frontend relay di 150 blok, keeper di 200 blok supaya tidak saling mendahului. */
export const DEFAULT_RELAY_AFTER = 200n;

export type KeeperAction = 'reveal' | 'settle' | 'reap';

export interface RunView {
  state: number;
  floor: number;
  targetBlock: bigint;
}

/** Aksi keeper untuk satu run di `block`, atau null kalau belum perlu disentuh. */
export function decide(run: RunView, block: bigint, relayAfter: bigint = DEFAULT_RELAY_AFTER): KeeperAction | null {
  if (run.state !== RunState.AWAIT_REVEAL && run.state !== RunState.AWAIT_SETTLE) return null;
  if (block > run.targetBlock + BLOCKHASH_WINDOW) return 'reap';
  if (block < run.targetBlock + relayAfter) return null;
  return run.state === RunState.AWAIT_REVEAL ? 'reveal' : 'settle';
}

/**
 * Batas atas gas per aksi (CONTRACT_SPEC §8, jadwal Monad + margin): combat 64 round, kematian dengan
 * insert board di posisi teratas, dan auto cash out di floor 20.
 */
export function worstCaseGas(action: KeeperAction, floor: number): bigint {
  if (action === 'settle' && floor === MAX_FLOOR) return 450_000n;
  return 250_000n;
}

/** Hasil sudah deterministik sebelum tx dikirim, jadi estimate akurat; +30% margin, dibatasi worst case. */
export function gasLimit(action: KeeperAction, floor: number, estimate: bigint | null): bigint {
  const worst = worstCaseGas(action, floor);
  if (estimate === null) return worst;
  const padded = (estimate * 130n) / 100n;
  return padded < worst ? padded : worst;
}
