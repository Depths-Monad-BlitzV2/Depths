'use client';

import { useState } from 'react';
import { parseEther } from 'viem';
import { useSendTransaction } from 'wagmi';
import { explorerAddress } from '@/lib/chains';
import { mon } from '@/lib/log';
import { DEFAULT_TOPUP, LOW_BALANCE, withdrawSession } from '@/lib/session';
import { describeTxError } from '@/lib/txQueue';
import { gameStore } from '@/store/game';
import type { DepthsGame } from './useDepthsGame';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Saldo session wallet (burner): chip saldo rendah, top-up dari wallet utama, withdraw (UI_UX §3.2, §6). */
export function SessionPanel({ game, balance, runActive }: { game: DepthsGame; balance: bigint | null; runActive: boolean }) {
  const [busy, setBusy] = useState<null | 'withdraw' | 'topup'>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(mon(DEFAULT_TOPUP));
  const { sendTransactionAsync } = useSendTransaction();
  const owner = game.owner;
  if (!game.session || !owner) return null;
  const low = balance !== null && balance < LOW_BALANCE;
  const link = explorerAddress(game.session.address);

  async function withdraw() {
    if (!game.session || !owner) return;
    setBusy('withdraw');
    try {
      await withdrawSession(game.client, game.session, owner);
      await game.refreshBalance();
    } catch (e) {
      gameStore.getState().setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function topUp() {
    if (!game.session) return;
    setBusy('topup');
    try {
      const hash = await sendTransactionAsync({ to: game.session.address, value: parseEther(amount || '0') });
      await game.client.waitForTransactionReceipt({ hash });
      await game.refreshBalance();
      setOpen(false);
    } catch (e) {
      gameStore.getState().setError(describeTxError((e as { details?: string; shortMessage?: string }).details ?? (e as { shortMessage?: string }).shortMessage ?? (e as Error).message, 'wallet'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between">
        <span className="opacity-60">Session wallet</span>
        {link ? (
          <a className="hover:underline" href={link} target="_blank" rel="noreferrer">
            {short(game.session.address)}
          </a>
        ) : (
          short(game.session.address)
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="opacity-60">Saldo gas</span>
        <span className="pixel">
          {balance === null ? '…' : `${mon(balance)} MON`}
          {low && <span className="ml-1 rounded bg-yellow-700 px-1 text-[10px] text-white">rendah</span>}
        </span>
      </div>
      {open ? (
        <div className="flex items-center gap-1">
          <input
            className="w-16 rounded bg-black px-1 py-0.5"
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
          />
          <span>MON</span>
          <button className="rounded bg-teal-800 px-2 py-0.5 disabled:opacity-40" disabled={busy !== null} onClick={topUp}>
            {busy === 'topup' ? '…' : 'Kirim'}
          </button>
          <button className="px-1 opacity-60" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            className={`rounded px-2 py-0.5 ${low ? 'bg-yellow-700 text-white' : 'bg-neutral-800'}`}
            onClick={() => setOpen(true)}
          >
            Top-up
          </button>
          <button
            className="rounded bg-neutral-800 px-2 py-0.5 disabled:opacity-40"
            disabled={busy !== null || runActive || !balance}
            title={runActive ? 'Selesaikan run dulu: session wallet membayar gas langkah berikutnya' : undefined}
            onClick={withdraw}
          >
            {busy === 'withdraw' ? 'Mengirim…' : 'Withdraw ke wallet utama'}
          </button>
        </div>
      )}
    </div>
  );
}
