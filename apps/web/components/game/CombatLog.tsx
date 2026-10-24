'use client';

import { useEffect, useRef } from 'react';
import type { LogLine } from '@/store/game';
import { Typewriter } from './Typewriter';

type Line = { text: string; tone?: LogLine['tone'] };

const toneClass = (tone: Line['tone']) => (tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-400' : '');

/**
 * Log event. Baris resolusi lantai ini (`live`) datang dari timeline scene, jadi ikut tempo dan skip
 * (UI_UX §2.1); setelah timeline selesai baris itu dipindah ke log permanen di store.
 * Baris terbaru diketik (Typewriter); riwayat yang sudah ada saat mount tampil langsung.
 */
export function CombatLog({ log, live, reducedMotion }: { log: LogLine[]; live: string[]; reducedMotion?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const lines: Line[] = [...log, ...live.map((text) => ({ text }))];
  const initial = useRef(lines.length);
  // gulir container log saja: scrollIntoView ikut menggulir halaman dan mendorong scene keluar layar
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, live.length]);

  const last = lines.at(-1);
  // key dari jumlah + teks: saat baris live pindah ke log, teks dan posisinya sama sehingga tidak diketik ulang
  const typeLast = !!last && lines.length > initial.current;
  return (
    <div ref={box} className="h-full min-h-0 overflow-y-auto font-mono text-xs leading-relaxed" aria-live="polite">
      {lines.length === 0 && <p className="opacity-40">&gt; Obor dinyalakan…</p>}
      {lines.slice(0, -1).map((l, i) => (
        <p key={i} className={toneClass(l.tone)}>
          &gt; {l.text}
        </p>
      ))}
      {last && (
        <p className={toneClass(last.tone)}>
          &gt;{' '}
          {typeLast ? (
            <Typewriter key={`${lines.length}:${last.text}`} text={last.text} cps={80} reducedMotion={reducedMotion} />
          ) : (
            last.text
          )}
        </p>
      )}
    </div>
  );
}
