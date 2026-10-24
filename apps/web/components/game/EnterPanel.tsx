'use client';

import { useState } from 'react';
import { parseEther } from 'viem';
import { useWriteContract } from 'wagmi';
import { depthsAbi, depthsAddress, MAX_GAS_TOPUP } from '@/lib/contracts';
import { mon } from '@/lib/log';
import { DEFAULT_TOPUP, LOW_BALANCE } from '@/lib/session';
import { describeTxError } from '@/lib/txQueue';
import { gameStore, useGame } from '@/store/game';
import { SpriteActor } from './SpriteActor';
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
      // alasan RPC ada di `details` (mis. saldo wallet utama belum terlihat konsensus, SPIKE_RESULTS Phase 6)
      store.setError(describeTxError((e as { details?: string; shortMessage?: string }).details ?? (e as { shortMessage?: string }).shortMessage ?? (e as Error).message, 'wallet'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center text-center">
        <div className="flex items-end gap-3">
          <SpriteActor sprite="heroIdle" scale={2} />
          <SpriteActor sprite="chestFull" scale={2} paused />
        </div>
        <h2 className="pixel mt-3 text-2xl tracking-widest text-gold">MASUK DUNGEON</h2>
        <p className="mt-1 text-sm text-foreground/80">Bayar masuk. Makin dalam, makin kaya.</p>
      </div>

      {game.newSession && (
        <p className="border-2 border-teal/40 bg-teal/10 p-2 text-xs leading-relaxed text-teal-100">
          Kami membuat session wallet supaya kamu tidak perlu approve tiap langkah. Kuncinya disimpan di browser ini,
          dan bag kamu selalu dikirim ke wallet utama, bukan ke session wallet.
        </p>
      )}

      <div className="pixel-input space-y-2 p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-foreground/80">Tiket masuk</span>
          <span className="pixel text-gold">{fee !== null ? mon(fee) : '…'} MON</span>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="text-foreground/80">
            Gas session
            {needsTopUp && (
              <span className="pixel mt-0.5 block w-fit whitespace-nowrap bg-amber-700 px-1 text-[9px] text-white">SALDO RENDAH</span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <input
              className="pixel-input pixel w-24 px-2 py-1 text-right text-sm"
              value={topUp}
              onChange={(e) => setTopUp(e.target.value)}
              inputMode="decimal"
              aria-label={`Top-up gas session wallet, maksimal ${mon(MAX_GAS_TOPUP)} MON`}
            />
            <span className="pixel text-xs">MON</span>
          </span>
        </label>
        <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-line pt-2">
          <span>Total</span>
          <span className="pixel text-gold">
            {fee !== null && topUpWei !== null && topUpValid ? mon(fee + topUpWei) : '…'} MON
          </span>
        </div>
      </div>
      {!topUpValid && <p className="text-sm text-red-400">Top-up harus antara 0 dan {mon(MAX_GAS_TOPUP)} MON.</p>}

      <button
        className="btn-blood pixel w-full rounded-sm px-4 py-3 text-sm text-white disabled:opacity-40 sm:text-base"
        disabled={busy || !topUpValid || fee === null || !game.machine}
        onClick={enter}
      >
        {busy ? 'Menunggu wallet…' : 'ENTER THE DUNGEON'}
      </button>
    </div>
  );
}
