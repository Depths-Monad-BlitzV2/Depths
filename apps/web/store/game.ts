import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Address } from 'viem';
import type { Phase, Snapshot } from '../lib/runMachine';
import type { TxRecord } from '../lib/txQueue';

// Store game (zustand vanilla supaya bisa dipakai juga di Node / scripts/e2e.ts).
// Sumber kebenaran tetap chain: snapshot selalu hasil readSnapshot, bukan state yang dikarang UI.

export interface LogLine {
  id: number;
  text: string;
  tone?: 'info' | 'good' | 'bad';
}

export interface GameState {
  owner: Address | null;
  session: Address | null;
  sessionBalance: bigint | null;
  snapshot: Snapshot | null;
  phase: Phase;
  txs: TxRecord[];
  log: LogLine[];
  error: string | null;
  /** Ringkasan run yang baru selesai (layar cash out / mati). */
  ended: { kind: 'cashOut' | 'death' | 'expired'; floor: number; amount: bigint } | null;

  setIdentity(owner: Address | null, session: Address | null): void;
  setSessionBalance(b: bigint | null): void;
  setSnapshot(s: Snapshot, phase: Phase): void;
  upsertTx(rec: TxRecord): void;
  pushLog(text: string, tone?: LogLine['tone']): void;
  setError(msg: string | null): void;
  setEnded(e: GameState['ended']): void;
  reset(): void;
}

const MAX_LOG = 200;
const MAX_TX = 50;
let logId = 0;

const initial = {
  owner: null,
  session: null,
  sessionBalance: null,
  snapshot: null,
  phase: { kind: 'noRun' } as Phase,
  txs: [] as TxRecord[],
  log: [] as LogLine[],
  error: null,
  ended: null,
};

export const gameStore = createStore<GameState>()((set) => ({
  ...initial,
  setIdentity: (owner, session) => set({ owner, session }),
  setSessionBalance: (sessionBalance) => set({ sessionBalance }),
  setSnapshot: (snapshot, phase) => set({ snapshot, phase }),
  upsertTx: (rec) =>
    set((s) => {
      const i = s.txs.findIndex((t) => t.id === rec.id);
      const txs = i === -1 ? [rec, ...s.txs].slice(0, MAX_TX) : s.txs.map((t, k) => (k === i ? rec : t));
      return { txs };
    }),
  pushLog: (text, tone) => set((s) => ({ log: [...s.log, { id: ++logId, text, tone }].slice(-MAX_LOG) })),
  setError: (error) => set({ error }),
  setEnded: (ended) => set({ ended }),
  reset: () => set({ ...initial }),
}));

export function useGame<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector);
}
