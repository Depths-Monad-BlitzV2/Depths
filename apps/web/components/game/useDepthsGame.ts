'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import type { Address, Chain, PublicClient, Transport } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { activeChain } from '@/lib/chains';
import { createDepthsClient } from '@/lib/client';
import { depthsAddress } from '@/lib/contracts';
import { Narrator } from '@/lib/narrator';
import { RunMachine } from '@/lib/runMachine';
import { loadOrCreateSession } from '@/lib/session';
import { TxQueue } from '@/lib/txQueue';
import { gameStore } from '@/store/game';

export interface DepthsGame {
  owner: Address | null;
  machine: RunMachine | null;
  session: PrivateKeyAccount | null;
  /** Burner baru dibuat di sesi ini → tampilkan penjelasan onboarding (UI_UX §5). */
  newSession: boolean;
  client: PublicClient<Transport, Chain>;
  wrongChain: boolean;
  refreshBalance: () => Promise<void>;
}

/**
 * Merakit session wallet + TxQueue + RunMachine untuk owner yang terhubung, dan menyalurkan
 * snapshot/tx ke store. Recovery saat refresh: RunMachine membaca state dari chain saat start
 * (ARCHITECTURE §6.3), lalu relay fallback dikirim otomatis kalau sudah ≥ 150 blok.
 */
export function useDepthsGame(): DepthsGame {
  const { address: owner, isConnected } = useAccount();
  const chainId = useChainId();
  const wrongChain = isConnected && chainId !== activeChain.id;
  const client = useMemo(() => createDepthsClient(), []);
  const [state, setState] = useState<{ machine: RunMachine; session: PrivateKeyAccount; created: boolean } | null>(
    null,
  );

  useEffect(() => {
    const store = gameStore.getState();
    if (!owner || wrongChain) {
      store.reset();
      setState(null);
      return;
    }
    const { account, created } = loadOrCreateSession(owner, window.localStorage);
    store.reset();
    store.setIdentity(owner, account.address);

    const address = depthsAddress();
    const queue = new TxQueue({
      client,
      account,
      address,
      onUpdate: (rec) => {
        gameStore.getState().upsertTx(rec);
        if (rec.status === 'success' || rec.status === 'reverted') {
          // DoD Phase 4: latency per tx tampil di console dan TxTicker
          console.info(`[depths tx] ${rec.label} ${rec.status} ${rec.latencyMs}ms (submit ${rec.submitMs}ms) gas ${rec.gas}`);
        }
      },
    });
    // baris combat/hasil ditulis PlayScreen mengikuti timeline scene, bukan saat snapshot datang
    const narrator = new Narrator(
      {
        log: (text, tone) => gameStore.getState().pushLog(text, tone),
        ended: (end) => gameStore.getState().setEnded(end),
      },
      { narrateResolution: false },
    );
    const machine = new RunMachine({
      client,
      address,
      owner,
      queue,
      onSnapshot: (s, p) => {
        narrator.push(s, p);
        gameStore.getState().setSnapshot(s, p);
        void client.getBalance({ address: account.address }).then((b) => gameStore.getState().setSessionBalance(b));
      },
      onError: (msg) => gameStore.getState().setError(msg),
    });
    machine.start();
    setState({ machine, session: account, created });
    return () => machine.stop();
  }, [owner, wrongChain, client]);

  const refreshBalance = async () => {
    if (!state) return;
    gameStore.getState().setSessionBalance(await client.getBalance({ address: state.session.address }));
  };

  return {
    owner: owner ?? null,
    machine: state?.machine ?? null,
    session: state?.session ?? null,
    newSession: state?.created ?? false,
    client,
    wrongChain,
    refreshBalance,
  };
}
