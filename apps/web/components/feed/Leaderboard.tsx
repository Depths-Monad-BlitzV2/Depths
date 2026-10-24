'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { explorerAddress } from '@/lib/chains';
import { depthsAbi, depthsAddress } from '@/lib/contracts';
import { mon } from '@/lib/log';
import { shortAddr, useDepthsClient, useDepthsFeed } from './useDepthsFeed';

type Tab = 'deep' | 'haul' | 'fallen';

interface Row {
  player: Address;
  floor: number;
  value: bigint;
  runId?: number;
}

/** Leaderboard (UI_UX §3.3): Deepest Dive dan Biggest Haul dari board on-chain, Hall of the Fallen dari event. */
export function Leaderboard() {
  const [tab, setTab] = useState<Tab>('deep');
  const boards = useBoards();
  // Hall of the Fallen: tidak ada board on-chain, jadi diambil dari event RunDied terbaru (±2000 blok)
  const { items, loading } = useDepthsFeed(2_000n, 200);
  const fallen: Row[] = items
    .filter((i) => i.kind === 'death' && i.amount > 0n)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .slice(0, 10)
    .map((i) => ({ player: i.owner, floor: i.floor, value: i.amount }));

  const rows = tab === 'deep' ? boards?.depths : tab === 'haul' ? boards?.cashouts : fallen;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'deep', label: 'Deepest Dive' },
    { id: 'haul', label: 'Biggest Haul' },
    { id: 'fallen', label: 'Hall of the Fallen' },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4 sm:p-8">
      <nav className="flex items-center justify-between text-sm">
        <Link href="/" className="pixel tracking-[0.3em]">
          DEPTHS
        </Link>
        <Link href="/play" className="pixel rounded bg-red-800 px-3 py-1 text-xs hover:bg-red-700">
          PLAY
        </Link>
      </nav>
      <h1 className="pixel text-2xl">LEADERBOARD</h1>
      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`pixel rounded px-3 py-1 text-xs ${tab === t.id ? 'bg-teal-800' : 'bg-neutral-800 hover:bg-neutral-700'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'fallen' && <p className="text-xs opacity-60">Bag terbesar yang hilang, dari kematian terbaru (±2000 blok).</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-widest opacity-60">
          <tr>
            <th className="py-1">#</th>
            <th>Player</th>
            <th>Lantai</th>
            <th className="text-right">{tab === 'fallen' ? 'Hilang' : tab === 'haul' ? 'Cash out' : 'Bag'}</th>
          </tr>
        </thead>
        <tbody>
          {!rows || (tab === 'fallen' && loading) ? (
            <tr>
              <td colSpan={4} className="py-3 opacity-50">
                Membaca prasasti…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-3 opacity-50">
                Belum ada nama di sini.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const link = explorerAddress(r.player);
              return (
                <tr key={`${r.player}-${i}`} className="border-t border-line">
                  <td className="pixel py-2">{i + 1}</td>
                  <td>
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" className="hover:underline">
                        {shortAddr(r.player)}
                      </a>
                    ) : (
                      shortAddr(r.player)
                    )}
                  </td>
                  <td className="pixel">{r.floor}</td>
                  <td className={`pixel text-right ${tab === 'fallen' ? 'text-red-400' : 'text-gold'}`}>{mon(r.value)} MON</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </main>
  );
}

function useBoards(): { cashouts: Row[]; depths: Row[] } | null {
  const client = useDepthsClient();
  const [b, setB] = useState<{ cashouts: Row[]; depths: Row[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      client
        .readContract({ address: depthsAddress(), abi: depthsAbi, functionName: 'getBoards' })
        .then(([cash, depth]) => {
          const rows = (list: typeof cash) =>
            list.filter((e) => e.floor > 0).map((e) => ({ player: e.player, floor: e.floor, value: e.value, runId: e.runId }));
          if (alive) setB({ cashouts: rows(cash), depths: rows(depth) });
        })
        .catch(() => undefined);
    void read();
    const t = setInterval(read, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [client]);
  return b;
}
