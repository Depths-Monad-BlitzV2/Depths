'use client';

import { useEffect, useState } from 'react';
import { PoolBadge } from '@/components/game/StatsHud';
import { depthsAbi, depthsAddress } from '@/lib/contracts';
import { mon } from '@/lib/log';
import { shortAddr, useDepthsClient, useDepthsFeed, usePoolInfo, type FeedItem } from './useDepthsFeed';

// Bagian landing yang membaca chain. Dimuat lazy (LandingIslands) supaya viem/ABI tidak menahan render awal.

export function PoolLive() {
  const info = usePoolInfo();
  return <PoolBadge pool={info?.[0] ?? null} />;
}

export function FeeLive() {
  const info = usePoolInfo(30_000);
  return <>{info ? mon(info[3]) : '1.000'}</>;
}

export function feedLine(i: FeedItem): string {
  if (i.kind === 'cashOut') return `${shortAddr(i.owner)} cash out ${mon(i.amount)} MON dari Lantai ${i.floor}`;
  if (i.kind === 'death') return `${shortAddr(i.owner)} mati di Lantai ${i.floor} (−${mon(i.amount)} MON)`;
  return `${shortAddr(i.owner)} memasuki dungeon`;
}

export function FeedAndStats() {
  const { items, loading } = useDepthsFeed();
  const stats = useStats();
  return (
    <>
      <div className="rounded border border-line bg-panel p-3 md:col-start-2 md:row-start-1">
        <div className="pixel mb-2 text-xs text-teal">LIVE FEED</div>
        <ul className="h-64 space-y-1 overflow-y-auto text-xs">
          {loading && <li className="text-foreground/70">Mendengarkan dungeon…</li>}
          {!loading && items.length === 0 && <li className="text-foreground/70">Sepi. Jadilah yang pertama turun.</li>}
          {items.map((i) => (
            <li key={i.key} className={i.kind === 'death' ? 'text-red-400' : i.kind === 'cashOut' ? 'text-emerald-300' : 'text-foreground/80'}>
              {feedLine(i)}
            </li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center md:col-span-2">
        <Stat label="Total run" value={stats.runs === null ? '…' : String(stats.runs)} />
        <Stat label="Kematian (terbaru)" value={loading ? '…' : String(items.filter((i) => i.kind === 'death').length)} />
        <Stat label="Lantai terdalam" value={stats.deepest === null ? '…' : stats.deepest ? String(stats.deepest) : '-'} />
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-panel p-3">
      <div className="text-[10px] uppercase tracking-widest text-foreground/70">{label}</div>
      <div className="pixel mt-1 text-xl">{value}</div>
    </div>
  );
}

/** Total run (nextRunId − 1) dan lantai terdalam (board kedalaman #1). */
function useStats(): { runs: number | null; deepest: number | null } {
  const client = useDepthsClient();
  const [s, setS] = useState<{ runs: number | null; deepest: number | null }>({ runs: null, deepest: null });
  useEffect(() => {
    const address = depthsAddress();
    let alive = true;
    const read = async () => {
      try {
        const [next, boards] = await Promise.all([
          client.readContract({ address, abi: depthsAbi, functionName: 'nextRunId' }),
          client.readContract({ address, abi: depthsAbi, functionName: 'getBoards' }),
        ]);
        if (alive) setS({ runs: Number(next) - 1, deepest: boards[1][0]?.floor ?? 0 });
      } catch {
        // abaikan; coba lagi interval berikutnya
      }
    };
    void read();
    const t = setInterval(read, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [client]);
  return s;
}
