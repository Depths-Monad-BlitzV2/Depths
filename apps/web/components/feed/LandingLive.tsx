'use client';

import { useEffect, useState } from 'react';
import { PoolBadge } from '@/components/game/StatsHud';
import { SpriteActor } from '@/components/game/SpriteActor';
import { depthsAbi, depthsAddress } from '@/lib/contracts';
import { mon } from '@/lib/log';
import type { SpriteKey } from '@/lib/sprites';
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

const FEED_ICON: Record<FeedItem['kind'], SpriteKey> = { death: 'skull', cashOut: 'coin', enter: 'heroIdle' };

export function FeedAndStats() {
  const { items, loading } = useDepthsFeed();
  const stats = useStats();
  return (
    <>
      <div className="stone flex flex-col p-3 md:col-start-2 md:row-start-1">
        <div className="pixel mb-3 flex items-center gap-2 text-xs text-teal">
          <span className="motion-ambient inline-block h-2 w-2 rounded-full bg-red-500" style={{ animation: 'torch-flicker 1.2s ease-in-out infinite' }} />
          KABAR DARI BAWAH
        </div>
        {/* list absolut di md supaya tinggi panel mengikuti peta kedalaman, bukan panjang feed */}
        <div className="relative h-72 md:h-auto md:flex-1">
          <ul className="absolute inset-0 space-y-1.5 overflow-y-auto pr-1 text-xs">
            {loading && <li className="text-foreground/70">Mendengarkan dungeon…</li>}
            {!loading && items.length === 0 && <li className="text-foreground/70">Sepi. Jadilah yang pertama turun.</li>}
            {items.map((i) => (
              <li
                key={i.key}
                className={`flex items-center gap-2 border-l-2 bg-black/30 px-2 py-1 ${
                  i.kind === 'death'
                    ? 'border-red-500 text-red-400'
                    : i.kind === 'cashOut'
                      ? 'border-emerald-400 text-emerald-300'
                      : 'border-line text-foreground/80'
                }`}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <FeedIcon kind={i.kind} />
                </span>
                {feedLine(i)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center md:col-span-2">
        <Stat icon="heroIdle" label="Total run" value={stats.runs === null ? '…' : String(stats.runs)} />
        <Stat icon="skull" label="Kematian (terbaru)" value={loading ? '…' : String(items.filter((i) => i.kind === 'death').length)} />
        <Stat icon="chestFull" label="Lantai terdalam" value={stats.deepest === null ? '…' : stats.deepest ? String(stats.deepest) : '-'} />
      </div>
    </>
  );
}

function FeedIcon({ kind }: { kind: FeedItem['kind'] }) {
  const sprite = FEED_ICON[kind];
  // heroIdle 16×28 terlalu tinggi untuk baris feed: tampilkan kepala saja
  if (sprite === 'heroIdle') {
    return (
      <span className="block h-4 w-4 overflow-hidden">
        <SpriteActor sprite={sprite} scale={1} paused style={{ marginTop: -6 }} />
      </span>
    );
  }
  return <SpriteActor sprite={sprite} scale={sprite === 'coin' || sprite === 'skull' ? 2 : 1} paused={sprite !== 'coin'} />;
}

function Stat({ icon, label, value }: { icon: SpriteKey; label: string; value: string }) {
  return (
    <div className="stone flex flex-col items-center p-3">
      <SpriteActor sprite={icon} scale={icon === 'heroIdle' ? 1 : icon === 'skull' ? 3 : 2} paused />
      <div className="mt-1 text-[10px] uppercase tracking-widest text-foreground/70">{label}</div>
      <div className="pixel mt-1 text-xl text-gold">{value}</div>
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
