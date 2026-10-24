'use client';

import { useEffect, useRef, useState } from 'react';
import { estimateWinChance, mulberry32, type CombatInput } from 'game-logic';

const SAMPLES = 500;

/** Estimasi win chance FIGHT (Monte Carlo 500× di Web Worker, fallback main thread). null = belum siap. */
export function useWinChance(input: CombatInput | null): number | null {
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const [result, setResult] = useState<{ key: string; p: number } | null>(null);
  const key = input ? JSON.stringify(input) : null;

  useEffect(() => {
    try {
      worker.current = new Worker(new URL('../../lib/winChance.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker.current = null;
    }
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => {
    if (!input || !key) return;
    const id = ++reqId.current;
    const seed = id * 2654435761;
    const w = worker.current;
    if (!w) {
      const t = setTimeout(() => setResult({ key, p: estimateWinChance(input, SAMPLES, mulberry32(seed)) }), 0);
      return () => clearTimeout(t);
    }
    const onMsg = (e: MessageEvent<{ id: number; p: number }>) => {
      if (e.data.id === id) setResult({ key, p: e.data.p });
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, input, samples: SAMPLES, seed });
    return () => w.removeEventListener('message', onMsg);
    // `key` mewakili isi `input`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return result && result.key === key ? result.p : null;
}
