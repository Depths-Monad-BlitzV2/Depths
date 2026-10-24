'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useSwitchChain } from 'wagmi';
import { activeChain } from '@/lib/chains';
import { mon } from '@/lib/log';
import { gameStore, useGame } from '@/store/game';
import { DecisionPanel } from './DecisionPanel';
import { EncounterPanel } from './EncounterPanel';
import { EnterPanel } from './EnterPanel';
import { LogPanel, SessionPanel, StatsPanel, TxTicker } from './Panels';
import { useDepthsGame, type DepthsGame } from './useDepthsGame';

/** Halaman /play versi kasar (Phase 4): seluruh alur enter → lantai → cash out / mati, tanpa art. */
export function PlayScreen() {
  const { isConnected } = useAccount();
  const game = useDepthsGame();
  const error = useGame((s) => s.error);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-widest">DEPTHS</h1>
        <ConnectButton chainStatus="icon" showBalance={false} />
      </header>

      {!isConnected && <p>Hubungkan wallet untuk masuk ke dungeon.</p>}
      {game.wrongChain && <WrongChain />}
      {error && (
        <div className="flex items-start justify-between gap-2 rounded border border-red-800 bg-red-950 p-2 text-sm">
          <span>{error}</span>
          <button className="opacity-70" onClick={() => gameStore.getState().setError(null)}>
            ✕
          </button>
        </div>
      )}

      {isConnected && !game.wrongChain && (
        <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
          <section className="min-h-64 rounded border border-neutral-800 p-4">
            <PhaseView game={game} />
          </section>
          <aside className="space-y-4 rounded border border-neutral-800 p-4">
            <StatsPanel />
            <SessionPanel game={game} />
          </aside>
          <section className="rounded border border-neutral-800 p-4 md:col-span-2">
            <LogPanel />
          </section>
        </div>
      )}

      <footer className="rounded border border-neutral-800 p-2">
        <TxTicker />
      </footer>
    </main>
  );
}

function WrongChain() {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <button
      className="w-fit rounded bg-yellow-700 px-4 py-2 font-bold disabled:opacity-40"
      disabled={isPending}
      onClick={() => switchChain({ chainId: activeChain.id })}
    >
      Switch to {activeChain.name}
    </button>
  );
}

function PhaseView({ game }: { game: DepthsGame }) {
  const phase = useGame((s) => s.phase);
  const snapshot = useGame((s) => s.snapshot);
  const ended = useGame((s) => s.ended);
  const [busy, setBusy] = useState(false);

  if (!snapshot) return <p className="opacity-60">Obor dinyalakan…</p>;

  switch (phase.kind) {
    case 'noRun':
      return (
        <div className="space-y-4">
          {ended && <EndSummary kind={ended.kind} floor={ended.floor} amount={ended.amount} />}
          <EnterPanel game={game} />
        </div>
      );
    case 'waitReveal':
      return <p className="text-lg italic">Something stirs in the dark… ({phase.blocksLeft} blok)</p>;
    case 'encounter':
      return <EncounterPanel key={`${snapshot.run.runId}:${snapshot.run.floor}`} game={game} phase={phase} />;
    case 'waitResolve':
      return <p className="text-lg italic">Kamu dan lawanmu saling mengukur… ({phase.blocksLeft} blok)</p>;
    case 'resolved':
    case 'cleared':
      return <DecisionPanel key={`${snapshot.run.runId}:${snapshot.run.floor}`} game={game} phase={phase} />;
    case 'dying':
      return (
        <div className="space-y-2">
          <p className="text-lg text-red-400">
            Kamu mati di Lantai {snapshot.run.floor}. {mon(snapshot.run.bag)} MON kini milik dungeon.
          </p>
          <p className="text-sm opacity-60">Mengunci hasil di chain…</p>
        </div>
      );
    case 'expired':
      return (
        <div className="space-y-2">
          <p className="text-lg text-red-400">Lost in the dark (timeout). Run ini hangus.</p>
          <button
            className="rounded bg-neutral-700 px-4 py-2 disabled:opacity-40"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await game.machine?.reap();
              } finally {
                setBusy(false);
              }
            }}
          >
            Tutup run
          </button>
        </div>
      );
  }
}

function EndSummary({ kind, floor, amount }: { kind: 'cashOut' | 'death' | 'expired'; floor: number; amount: bigint }) {
  if (kind === 'cashOut') {
    return <p className="text-xl text-emerald-300">Kamu keluar hidup-hidup membawa {mon(amount)} MON (lantai {floor}).</p>;
  }
  if (kind === 'expired') {
    return <p className="text-xl text-red-400">Tersesat dalam gelap di Lantai {floor}. {mon(amount)} MON kini milik dungeon.</p>;
  }
  return <p className="text-xl text-red-400">Kamu mati di Lantai {floor}. {mon(amount)} MON kini milik dungeon.</p>;
}
