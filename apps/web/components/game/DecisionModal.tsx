'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_FLOOR, monster } from 'game-logic';
import { mon } from '@/lib/log';
import { cappedAward } from '@/lib/runMachine';

/** Durasi hold GO DEEPER di floor ≥ 5 (UI_UX §4). */
export const HOLD_MS = 600;
export const HOLD_FROM_FLOOR = 5;

export interface DecisionModalProps {
  floor: number;
  bag: bigint;
  hp: number;
  maxHp: number;
  pool: bigint;
  outcome?: string;
  busy: null | 'cash' | 'deeper';
  reducedMotion: boolean;
  onCashOut: () => void;
  onDeeper: () => void;
}

/** CASH OUT vs GO DEEPER: momen utama (UI_UX §4). Hotkey C / D. */
export function DecisionModal(p: DecisionModalProps) {
  const next = p.floor < MAX_FLOOR ? monster(p.floor + 1) : null;
  const needHold = p.floor >= HOLD_FROM_FLOOR;
  const hold = useHold(needHold ? HOLD_MS : 0, p.onDeeper, !next || p.busy !== null);

  // hotkey: C cash out, D go deeper (tahan D kalau perlu hold)
  const { onCashOut } = p;
  const busy = p.busy !== null;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || busy || e.target instanceof HTMLInputElement) return;
      if (e.key === 'c' || e.key === 'C') onCashOut();
      if ((e.key === 'd' || e.key === 'D') && next) hold.start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') hold.cancel();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [busy, next, onCashOut, hold]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center md:absolute md:z-20 bg-black/60 p-3" role="dialog" aria-modal>
      <div
        className="pixel-panel w-full max-w-md p-5 text-center"
        style={{ animation: p.reducedMotion ? undefined : 'fade-in 200ms ease-out' }}
      >
        {p.outcome && <p className="mb-2 text-sm opacity-80">{p.outcome}</p>}
        <h2 className="pixel text-2xl tracking-widest">FLOOR {p.floor} CLEARED</h2>
        <div className="pixel mt-3 flex justify-center gap-6 text-sm">
          <span className="text-gold">BAG {mon(p.bag)}</span>
          <span>
            HP {p.hp}/{p.maxHp}
          </span>
        </div>
        {next ? (
          <p className="mt-3 text-sm opacity-80">
            Lantai {p.floor + 1}: monster ≈ HP {next.hp}, ATK {next.atk}, loot sampai {mon(cappedAward(next.loot, p.pool))} MON
          </p>
        ) : (
          <p className="mt-3 text-sm opacity-80">Ini lantai terdalam. Tidak ada jalan turun lagi.</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            className="pixel rounded border-2 border-black bg-gradient-to-b from-amber-300 to-amber-500 px-3 py-3 text-sm text-amber-950 shadow-[inset_2px_2px_0_rgba(255,255,255,0.45),inset_-2px_-3px_0_rgba(0,0,0,0.25),0_3px_0_#000] hover:brightness-110 active:translate-y-0.5 disabled:opacity-40"
            disabled={p.busy !== null}
            onClick={p.onCashOut}
          >
            {p.busy === 'cash' ? 'Memanjat keluar…' : `CASH OUT ${mon(p.bag)}`}
            <span className="block text-[10px] opacity-60">[C]</span>
          </button>
          {next ? (
            <button
              className="pixel relative overflow-hidden rounded border-2 border-black bg-gradient-to-b from-emerald-400 to-emerald-600 px-3 py-3 text-sm text-emerald-950 shadow-[inset_2px_2px_0_rgba(255,255,255,0.45),inset_-2px_-3px_0_rgba(0,0,0,0.25),0_3px_0_#000,0_0_22px_rgba(52,211,153,0.6)] ring-2 ring-emerald-300/60 ring-offset-2 ring-offset-panel hover:brightness-110 active:translate-y-0.5 disabled:opacity-40"
              disabled={p.busy !== null}
              onPointerDown={hold.start}
              onPointerUp={hold.cancel}
              onPointerLeave={hold.cancel}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) hold.start();
              }}
              onKeyUp={(e) => {
                if (e.key === 'Enter' || e.key === ' ') hold.cancel();
              }}
            >
              <span
                className="absolute inset-y-0 left-0 bg-white/40"
                style={{ width: `${hold.progress * 100}%`, transition: hold.progress ? 'none' : 'width 150ms' }}
              />
              <span className="relative">
                {p.busy === 'deeper' ? 'Menuruni tangga…' : 'GO DEEPER'}
                <span className="block text-[10px] opacity-60">{needHold ? 'tahan [D]' : '[D]'}</span>
              </span>
            </button>
          ) : (
            <div />
          )}
        </div>
      </div>
    </div>
  );
}

/** Hold-to-confirm: `fire` dipanggil setelah ditahan `ms` (0 = langsung). */
function useHold(ms: number, fire: () => void, disabled: boolean) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const fireRef = useRef(fire);
  fireRef.current = fire;

  const cancel = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (disabled || raf.current !== null) return;
    if (ms === 0) return fireRef.current();
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setProgress(p);
      if (p >= 1) {
        raf.current = null;
        setProgress(0);
        fireRef.current();
      } else {
        raf.current = requestAnimationFrame(tick);
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, [ms, disabled]);

  useEffect(() => cancel, [cancel]);
  return { progress, start, cancel };
}
