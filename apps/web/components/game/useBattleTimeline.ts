'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LUNGE_MS, eventDuration, type SceneEvent } from '@/lib/scene';

/** `prefers-reduced-motion` (UI_UX §7). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

export interface TimelineState {
  /** Event yang sedang diputar (-1 = belum mulai). */
  index: number;
  /** `windup` = aktor maju (lunge), `impact` = kena + angka damage. */
  stage: 'windup' | 'impact';
  done: boolean;
  current: SceneEvent | null;
  skip: () => void;
}

/**
 * Pemutar timeline scene (UI_UX §2.2): satu sumber timing untuk scene, HP bar, dan CombatLog.
 * `key` baru = timeline baru dari awal. `key` null = tidak ada yang diputar.
 * Tombol skip / `Space` langsung loncat ke event terakhir.
 */
export function useBattleTimeline(key: string | null, events: SceneEvent[], reducedMotion: boolean): TimelineState {
  const [st, setSt] = useState<{ key: string | null; index: number; stage: 'windup' | 'impact'; done: boolean }>({
    key: null,
    index: -1,
    stage: 'impact',
    done: false,
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    clear();
    if (!key) {
      setSt({ key: null, index: -1, stage: 'impact', done: false });
      return;
    }
    const evs = eventsRef.current;
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    let t = 0;
    evs.forEach((e, i) => {
      const lunge = e.type === 'playerHit' || e.type === 'monsterHit';
      const windup = lunge ? Math.min(LUNGE_MS, eventDuration(e, { reducedMotion }) / 2) : 0;
      at(t, () => setSt({ key, index: i, stage: lunge ? 'windup' : 'impact', done: false }));
      if (lunge) at(t + windup, () => setSt({ key, index: i, stage: 'impact', done: false }));
      t += eventDuration(e, { reducedMotion });
    });
    at(t, () => setSt({ key, index: evs.length - 1, stage: 'impact', done: true }));
    setSt({ key, index: -1, stage: 'impact', done: evs.length === 0 });
    return clear;
  }, [key, reducedMotion]);

  const skip = useCallback(() => {
    clear();
    setSt((s) => (s.key ? { key: s.key, index: eventsRef.current.length - 1, stage: 'impact', done: true } : s));
  }, []);

  useEffect(() => {
    if (!key) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, skip]);

  const valid = st.key === key;
  const index = valid ? st.index : -1;
  return {
    index,
    stage: valid ? st.stage : 'impact',
    done: valid ? st.done : false,
    current: index >= 0 ? (events[index] ?? null) : null,
    skip,
  };
}
