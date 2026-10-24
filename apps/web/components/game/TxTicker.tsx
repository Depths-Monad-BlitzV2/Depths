'use client';

import { explorerTx } from '@/lib/chains';
import type { TxRecord } from '@/lib/txQueue';

/** Riwayat tx run: nama fungsi, latency ms, link explorer (UI_UX §1.2, §3.2). Terbaru di kiri. */
export function TxTicker({ txs }: { txs: TxRecord[] }) {
  const done = txs.filter((t) => t.latencyMs !== undefined && !t.relay && t.id > 0);
  const avg = done.length ? Math.round(done.reduce((s, t) => s + (t.latencyMs ?? 0), 0) / done.length) : null;
  return (
    <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap text-xs">
      <span className="pixel shrink-0 text-teal">TX</span>
      {avg !== null && <span className="shrink-0 opacity-60">rata-rata {avg}ms</span>}
      {txs.length === 0 && <span className="opacity-40">belum ada transaksi</span>}
      {txs.map((t) => {
        const pending = t.status === 'pending' || t.status === 'queued';
        const bad = t.status === 'reverted' || t.status === 'failed';
        const link = t.hash ? explorerTx(t.hash) : null;
        const body = (
          <>
            <span className="opacity-50">▸</span> {t.label}{' '}
            {pending ? (
              <span className="animate-pulse text-gold">…</span>
            ) : (
              <>
                <span className={bad ? 'text-danger' : 'text-teal'}>{t.latencyMs !== undefined ? `${t.latencyMs}ms` : ''}</span>{' '}
                {bad ? '✗' : '✓'}
              </>
            )}
            {t.relay && <span className="ml-1 rounded bg-teal/15 px-1 text-[10px] text-teal">hasil dikunci</span>}
          </>
        );
        return (
          <span key={t.id} className="shrink-0" title={t.error}>
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" className="hover:underline">
                {body}
              </a>
            ) : (
              body
            )}
          </span>
        );
      })}
    </div>
  );
}
