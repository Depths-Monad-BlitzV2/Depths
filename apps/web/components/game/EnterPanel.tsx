'use client';

import { useState } from 'react';
import { parseEther } from 'viem';
import { useWriteContract } from 'wagmi';
import { depthsAbi, depthsAddress, MAX_GAS_TOPUP } from '@/lib/contracts';
import { mon } from '@/lib/log';
import { DEFAULT_TOPUP, LOW_BALANCE } from '@/lib/session';
import { gameStore, useGame } from '@/store/game';
import type { DepthsGame } from './useDepthsGame';

let enterTxId = -1;

/** Satu-satunya popup main wallet per run: enterDungeon(session) dengan fee + top-up gas burner. */
export function EnterPanel({ game }: { game: DepthsGame }) {
  const snapshot = useGame((s) => s.snapshot);
  const balance = useGame((s) => s.sessionBalance);
  const [topUp, setTopUp] = useState(mon(DEFAULT_TOPUP));
  const [busy, setBusy] = useState(false);
  const { writeContractAsync } = useWriteContract();

  const fee = snapshot?.pool[3] ?? null;
  let topUpWei: bigint | null = null;
  try {
    topUpWei = parseEther(topUp || '0');
  } catch {
    topUpWei = null;
  }
  const topUpValid = topUpWei !== null && topUpWei >= 0n && topUpWei <= MAX_GAS_TOPUP;
  const needsTopUp = balance !== null && balance < LOW_BALANCE;

  async function enter() {
    if (!game.session || fee === null || topUpWei === null) return;
    const store = gameStore.getState();
    setBusy(true);
    store.setError(null);
    store.setEnded(null);
    const id = enterTxId--;
    try {
      const hash = await writeContractAsync({
        address: depthsAddress(),
        abi: depthsAbi,
        functionName: 'enterDungeon',
        args: [game.session.address],
        value: fee + topUpWei,
      });
      const t0 = performance.now();
      store.upsertTx({ id, label: 'enterDungeon (wallet)', status: 'pending', gas: 0n, hash });
      const rc = await game.client.waitForTransactionReceipt({ hash });
      const latencyMs = Math.round(performance.now() - t0);
      store.upsertTx({ id, label: 'enterDungeon (wallet)', status: rc.status === 'success' ? 'success' : 'reverted', gas: rc.gasUsed, hash, latencyMs, block: rc.blockNumber });
      console.info(`[depths tx] enterDungeon ${rc.status} ${latencyMs}ms (setelah tanda tangan)`);
      await game.machine?.refresh();
      await game.refreshBalance();
    } catch (e) {
      store.setError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-lg">Bayar masuk. Makin dalam, makin kaya.</p>
      {game.newSession && (
        <p className="rounded border border-teal-700 p-2 text-sm text-teal-200">
          Kami membuat session wallet supaya kamu tidak perlu approve tiap langkah. Kuncinya disimpan di browser ini,
          dan bag kamu selalu dikirim ke wallet utama, bukan ke session wallet.
        </p>
      )}
      <label className="block text-sm">
        Top-up gas session wallet (MON, maks {mon(MAX_GAS_TOPUP)}){needsTopUp ? ' — saldo session rendah' : ''}
        <input
          className="mt-1 block w-40 rounded bg-neutral-800 px-2 py-1"
          value={topUp}
          onChange={(e) => setTopUp(e.target.value)}
          inputMode="decimal"
        />
      </label>
      {!topUpValid && <p className="text-sm text-red-400">Top-up harus antara 0 dan {mon(MAX_GAS_TOPUP)} MON.</p>}
      <button
        className="rounded bg-red-700 px-4 py-2 font-bold disabled:opacity-40"
        disabled={busy || !topUpValid || fee === null || !game.machine}
        onClick={enter}
      >
        {busy ? 'Menunggu wallet…' : `ENTER THE DUNGEON — ${fee !== null ? mon(fee) : '…'} MON`}
      </button>
      {fee !== null && topUpWei !== null && topUpValid && (
        <p className="text-xs opacity-60">
          Total {mon(fee + topUpWei)} MON: entry {mon(fee)} + top-up {mon(topUpWei)} ke session wallet.
        </p>
      )}
    </div>
  );
}
