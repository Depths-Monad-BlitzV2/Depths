'use client';

import { useEffect, useState } from 'react';
import { explorerTx } from '@/lib/chains';
import type { TxRecord } from '@/lib/txQueue';

/** Lama toast tetap tampil setelah tx selesai (ms). Tx berikutnya langsung menggantikannya. */
const LINGER_MS = 4000;

/**
 * Toast tx terbaru: nama fungsi, latency ms, link explorer (UI_UX §1.2, §3.2). Satu toast saja,
 * otomatis diganti tx baru; tetap tampil selama pending, lalu hilang sendiri setelah selesai.
 */
export function TxToast({ txs }: { txs: TxRecord[] }) {
  const t = txs[0];
  const pending = !!t && (t.status === 'pending' || t.status === 'queued');
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const key = t ? `${t.id}:${t.status}` : null;

  useEffect(() => {
    if (!key || pending) return;
    const timer = setTimeout(() => setHiddenKey(key), LINGER_MS);
    return () => clearTimeout(timer);
  }, [key, pending]);

  if (!t || hiddenKey === key) return null;
  const bad = t.status === 'reverted' || t.status === 'failed';
  const link = t.hash ? explorerTx(t.hash) : null;
  const body = (
    <>
      <span className="pixel text-[10px] text-teal">TX</span>
      <span className="truncate">{t.label}</span>
      {pending ? (
        <span className="animate-pulse text-gold">…</span>
      ) : (
        <span className={bad ? 'text-danger' : 'text-teal'}>
          {t.latencyMs !== undefined ? `${t.latencyMs}ms ` : ''}
          {bad ? '✗' : '✓'}
        </span>
      )}
      {t.relay && <span className="rounded bg-teal/15 px-1 text-[10px] text-teal">hasil dikunci</span>}
    </>
  );
  return (
    <div
      key={t.id}
      role="status"
      title={t.error}
      className="pixel-panel pointer-events-auto fixed left-1/2 top-14 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-xs md:left-4 md:top-auto md:bottom-4 md:translate-x-0"
      style={{ animation: 'toast-in 180ms ease-out' }}
    >
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:underline">
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  );
}
