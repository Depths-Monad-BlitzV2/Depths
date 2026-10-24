'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { createDepthsClient } from '@/lib/client';
import { DEPLOY_BLOCK, depthsAbi, depthsAddress, type PoolInfo } from '@/lib/contracts';

// Data publik tanpa wallet (landing, leaderboard): pool, board, dan feed event terbaru.
// RPC publik membatasi range eth_getLogs, jadi scan per 100 blok (ARCHITECTURE §8).

const LOG_RANGE = 100n;

export interface FeedItem {
  key: string;
  kind: 'cashOut' | 'death' | 'enter';
  owner: Address;
  floor: number;
  amount: bigint;
  block: bigint;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-2)}`;
}

export function useDepthsClient() {
  return useMemo(() => createDepthsClient(), []);
}

/** Pool info live (poll). */
export function usePoolInfo(pollMs = 4_000): PoolInfo | null {
  const client = useDepthsClient();
  const [info, setInfo] = useState<PoolInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      client
        .readContract({ address: depthsAddress(), abi: depthsAbi, functionName: 'poolInfo' })
        .then((p) => alive && setInfo(p))
        .catch(() => undefined);
    void read();
    const t = setInterval(read, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [client, pollMs]);
  return info;
}

/**
 * Feed event CashedOut / RunDied / RunStarted: scan `lookback` blok terakhir saat mount,
 * lalu ikuti blok baru. Terbaru di depan.
 */
export function useDepthsFeed(lookback = 300n, max = 30): { items: FeedItem[]; loading: boolean } {
  const client = useDepthsClient();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let scanned = 0n;
    const address = depthsAddress();

    const scan = async (from: bigint, to: bigint) => {
      const found: FeedItem[] = [];
      for (let a = from; a <= to; a += LOG_RANGE) {
        const b = a + LOG_RANGE - 1n < to ? a + LOG_RANGE - 1n : to;
        const logs = await client.getContractEvents({ address, abi: depthsAbi, fromBlock: a, toBlock: b });
        for (const l of logs) {
          const key = `${l.transactionHash}:${l.logIndex}`;
          if (l.eventName === 'CashedOut' && l.args.owner) {
            found.push({ key, kind: 'cashOut', owner: l.args.owner, floor: l.args.floor ?? 0, amount: l.args.amount ?? 0n, block: l.blockNumber });
          } else if (l.eventName === 'RunDied' && l.args.owner) {
            found.push({ key, kind: 'death', owner: l.args.owner, floor: l.args.floor ?? 0, amount: l.args.lostBag ?? 0n, block: l.blockNumber });
          } else if (l.eventName === 'RunStarted' && l.args.owner) {
            found.push({ key, kind: 'enter', owner: l.args.owner, floor: 1, amount: l.args.entryFee ?? 0n, block: l.blockNumber });
          }
        }
      }
      if (!alive || found.length === 0) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.key));
        return [...found.filter((f) => !seen.has(f.key)).reverse(), ...prev].slice(0, max);
      });
    };

    const tick = async () => {
      try {
        const latest = await client.getBlockNumber();
        if (scanned === 0n) {
          const start = latest > lookback ? latest - lookback : 0n;
          scanned = (start > DEPLOY_BLOCK ? start : DEPLOY_BLOCK) - 1n;
        }
        if (latest > scanned) {
          await scan(scanned + 1n, latest);
          scanned = latest;
        }
      } catch {
        // RPC sibuk: coba lagi tick berikutnya
      } finally {
        if (alive) setLoading(false);
      }
    };
    void tick();
    const t = setInterval(tick, 3_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [client, lookback, max]);

  return { items, loading };
}
