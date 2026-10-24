'use client';

import { useEffect, useState } from 'react';

/**
 * Teks yang diketik huruf per huruf. Klik untuk langsung tampil penuh; reduced motion = tampil penuh.
 * Screen reader membaca teks utuh sekali (sr-only), bukan tiap huruf.
 */
export function Typewriter({
  text,
  cps = 45,
  reducedMotion = false,
  className,
}: {
  text: string;
  /** Karakter per detik. */
  cps?: number;
  reducedMotion?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(reducedMotion ? text.length : 0);

  useEffect(() => {
    if (reducedMotion) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(t) {
      const n = Math.min(text.length, Math.floor(((t - t0) / 1000) * cps));
      setShown(n);
      if (n < text.length) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [text, cps, reducedMotion]);

  const typing = shown < text.length;
  return (
    <span className={className} onClick={typing ? () => setShown(text.length) : undefined}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.slice(0, shown)}
        {typing && <span className="ml-px inline-block w-[0.5em] animate-pulse bg-current opacity-70">&nbsp;</span>}
      </span>
    </span>
  );
}
