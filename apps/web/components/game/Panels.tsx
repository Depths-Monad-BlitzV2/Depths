'use client';

import { useState } from 'react';
import { RunState } from 'game-logic';
import { explorerAddress, explorerTx } from '@/lib/chains';
import { mon } from '@/lib/log';
import { RELAY_AFTER_BLOCKS } from '@/lib/runMachine';
import { LOW_BALANCE, withdrawSession } from '@/lib/session';
import { gameStore, useGame } from '@/store/game';
import type { DepthsGame } from './useDepthsGame';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** HP, ATK, inventory, bag, pool, dan countdown relay (versi kasar StatsHud). */
export function StatsPanel() {
  const snapshot = useGame((s) => s.snapshot);
  if (!snapshot) return <p className="opacity-60">Membaca dungeon…</p>;
  const { run, pool, block } = snapshot;
  const active = run.state !== RunState.NONE;
  const pending = run.state === RunState.AWAIT_REVEAL || run.state === RunState.AWAIT_SETTLE;
  const sinceTarget = block > run.targetBlock ? block - run.targetBlock : 0n;
  return (
    <div className="space-y-1 text-sm">
      <p className="text-base font-bold">POOL {mon(pool[0])} MON</p>
      {active ? (
        <>
          <p>FLOOR {run.floor} / 20</p>
          <p>❤ HP {run.hp} / {run.maxHp}</p>
          <p>⚔ ATK {run.atk}</p>
          <p>
            🧪 x{run.potions} 🗡 x{run.swords} 🛡 x{run.shields}
          </p>
          <p className="font-bold text-amber-300">💰 BAG {mon(run.bag)} MON</p>
          {pending && sinceTarget > 0n && (
            <p className="text-xs opacity-60">
              Blok target lewat {sinceTarget.toString()} blok. Relay otomatis di {RELAY_AFTER_BLOCKS.toString()} blok, run
              hangus di 256.
            </p>
          )}
        </>
      ) : (
        <p className="opacity-60">Belum ada run.</p>
      )}
    </div>
  );
}

/** Saldo session wallet (burner), chip saldo rendah, dan withdraw ke wallet utama. */
export function SessionPanel({ game }: { game: DepthsGame }) {
  const session = useGame((s) => s.session);
  const owner = useGame((s) => s.owner);
  const balance = useGame((s) => s.sessionBalance);
  const runActive = useGame((s) => (s.snapshot?.run.state ?? RunState.NONE) !== RunState.NONE);
  const [busy, setBusy] = useState(false);
  if (!session || !owner) return null;
  const link = explorerAddress(session);

  async function withdraw() {
    if (!game.session || !owner) return;
    setBusy(true);
    try {
      await withdrawSession(game.client, game.session, owner);
      await game.refreshBalance();
    } catch (e) {
      gameStore.getState().setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1 text-sm">
      <p>
        Session wallet{' '}
        {link ? (
          <a className="underline" href={link} target="_blank" rel="noreferrer">
            {short(session)}
          </a>
        ) : (
          short(session)
        )}
      </p>
      <p>
        Saldo {balance === null ? '…' : `${mon(balance)} MON`}
        {balance !== null && balance < LOW_BALANCE && (
          <span className="ml-2 rounded bg-yellow-700 px-1 text-xs">saldo rendah</span>
        )}
      </p>
      <button
        className="rounded bg-neutral-800 px-2 py-1 text-xs disabled:opacity-40"
        disabled={busy || runActive || !balance}
        title={runActive ? 'Selesaikan run dulu: session wallet membayar gas langkah berikutnya' : undefined}
        onClick={withdraw}
      >
        {busy ? 'Mengirim…' : 'Withdraw saldo session ke wallet utama'}
      </button>
    </div>
  );
}

/** Riwayat tx run ini dengan latency (versi kasar TxTicker). */
export function TxTicker() {
  const txs = useGame((s) => s.txs);
  if (txs.length === 0) return <p className="text-xs opacity-50">TX ▸ belum ada transaksi</p>;
  return (
    <div className="flex gap-3 overflow-x-auto whitespace-nowrap text-xs">
      <span className="opacity-50">TX</span>
      {txs.map((t) => {
        const icon = t.status === 'success' ? '✓' : t.status === 'pending' || t.status === 'queued' ? '…' : '✗';
        const link = t.hash ? explorerTx(t.hash) : null;
        const body = (
          <>
            ▸ {t.label} {t.latencyMs !== undefined ? `${t.latencyMs}ms ` : ''}
            {icon}
            {t.relay ? ' · hasil dikunci' : ''}
          </>
        );
        return (
          <span key={t.id} className={t.status === 'reverted' || t.status === 'failed' ? 'text-red-400' : ''} title={t.error}>
            {link ? (
              <a href={link} target="_blank" rel="noreferrer">
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

export function LogPanel() {
  const log = useGame((s) => s.log);
  return (
    <div className="h-64 overflow-y-auto font-mono text-xs">
      {log.length === 0 && <p className="opacity-50">&gt; …</p>}
      {log.map((l) => (
        <p key={l.id} className={l.tone === 'good' ? 'text-emerald-300' : l.tone === 'bad' ? 'text-red-400' : ''}>
          &gt; {l.text}
        </p>
      ))}
    </div>
  );
}
