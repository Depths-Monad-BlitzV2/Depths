'use client';

import { useEffect, useRef } from 'react';
import type { LogLine } from '@/store/game';

/**
 * Log event. Baris resolusi lantai ini (`live`) datang dari timeline scene, jadi ikut tempo dan skip
 * (UI_UX §2.1); setelah timeline selesai baris itu dipindah ke log permanen di store.
 */
export function CombatLog({ log, live }: { log: LogLine[]; live: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  // gulir container log saja: scrollIntoView ikut menggulir halaman dan mendorong scene keluar layar
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, live.length]);
  return (
    <div ref={box} className="h-full min-h-0 overflow-y-auto font-mono text-xs leading-relaxed" aria-live="polite">
      {log.length === 0 && live.length === 0 && <p className="opacity-40">&gt; Obor dinyalakan…</p>}
      {log.map((l) => (
        <p key={l.id} className={l.tone === 'good' ? 'text-emerald-300' : l.tone === 'bad' ? 'text-red-400' : ''}>
          &gt; {l.text}
        </p>
      ))}
      {live.map((t, i) => (
        <p key={`live-${i}`} className="text-foreground/90">
          &gt; {t}
        </p>
      ))}
    </div>
  );
}
