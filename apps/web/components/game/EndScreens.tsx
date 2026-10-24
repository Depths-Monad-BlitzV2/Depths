'use client';

import type { ReactNode } from 'react';
import { mon } from '@/lib/log';

function Overlay({ tone, children }: { tone: 'death' | 'win'; children: ReactNode }) {
  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center md:absolute md:z-20 p-3 ${tone === 'death' ? 'bg-red-950/70' : 'bg-black/60'}`}
      role="dialog"
      aria-modal
      style={{ animation: 'fade-in 500ms ease-out' }}
    >
      <div className="w-full max-w-md rounded-lg border-2 border-line bg-panel/95 p-5 text-center shadow-2xl">{children}</div>
    </div>
  );
}

/** Layar mati (UI_UX §3.2, §6). `pending` = settle kematian belum masuk chain. */
export function DeathScreen(props: {
  floor: number;
  lost: bigint;
  cause: 'killed' | 'expired';
  pending?: boolean;
  onRetry?: () => void;
  onReap?: () => void;
  busy?: boolean;
}) {
  const { floor, lost, cause, pending, onRetry, onReap, busy } = props;
  return (
    <Overlay tone="death">
      <h2 className="pixel text-2xl tracking-widest text-danger">{cause === 'expired' ? 'LOST IN THE DARK' : 'YOU DIED'}</h2>
      <p className="mt-3">
        Kamu mati di Lantai {floor}. <span className="pixel text-gold">{mon(lost)} MON</span> kini milik dungeon.
      </p>
      {cause === 'expired' && <p className="mt-1 text-sm opacity-70">Penyebab: timeout. Langkah tidak diselesaikan dalam 256 blok.</p>}
      {pending ? (
        <p className="mt-4 text-sm italic opacity-70">Dungeon mencatat kematianmu…</p>
      ) : onReap ? (
        <button className="pixel mt-4 rounded bg-neutral-700 px-4 py-2 text-sm disabled:opacity-40" disabled={busy} onClick={onReap}>
          {busy ? 'Menutup run…' : 'Tutup run'}
        </button>
      ) : (
        onRetry && (
          <button className="pixel mt-4 rounded bg-red-800 px-4 py-2 text-sm hover:bg-red-700" onClick={onRetry}>
            Coba lagi
          </button>
        )
      )}
    </Overlay>
  );
}

export function CashOutScreen({ floor, amount, onAgain }: { floor: number; amount: bigint; onAgain: () => void }) {
  return (
    <Overlay tone="win">
      <h2 className="pixel text-2xl tracking-widest text-gold">ESCAPED</h2>
      <p className="mt-3">
        Kamu keluar hidup-hidup dari Lantai {floor} membawa <span className="pixel text-gold">{mon(amount)} MON</span>.
      </p>
      <p className="mt-1 text-sm opacity-70">Sudah dikirim ke wallet utamamu.</p>
      <button className="pixel mt-4 rounded bg-emerald-700 px-4 py-2 text-sm hover:bg-emerald-600" onClick={onAgain}>
        Masuk lagi
      </button>
    </Overlay>
  );
}
