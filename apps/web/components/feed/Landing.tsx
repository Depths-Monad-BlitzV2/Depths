'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { depthsAbi, depthsAddress } from '@/lib/contracts';
import { mon } from '@/lib/log';
import { PoolBadge } from '@/components/game/StatsHud';
import { shortAddr, useDepthsClient, useDepthsFeed, usePoolInfo, type FeedItem } from './useDepthsFeed';

const STEPS = [
  { title: 'Bayar', text: '1 MON masuk dungeon. Satu popup wallet, sisanya otomatis.' },
  { title: 'Turun', text: 'Tiap lantai: monster, peti, jebakan, atau pedagang. Acak dari blok masa depan.' },
  { title: 'Pilih', text: 'Setelah lantai clear: bawa pulang bag, atau turun lebih dalam.' },
  { title: 'Cash out atau mati', text: 'Mati = bag-mu jadi prize pool untuk pemain berikutnya.' },
];

/** Landing (UI_UX §3.1): pool live, CTA, live feed, statistik, how it works. */
export function Landing() {
  const info = usePoolInfo();
  const { items, loading } = useDepthsFeed();
  const stats = useStats();
  const fee = info?.[3];

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 p-4 sm:p-8">
      <nav className="flex items-center justify-between text-sm">
        <span className="pixel tracking-[0.3em]">DEPTHS</span>
        <Link href="/leaderboard" className="opacity-70 hover:opacity-100">
          Leaderboard
        </Link>
      </nav>

      <section className="grid items-center gap-8 md:grid-cols-[1fr_20rem]">
        <div className="space-y-5 text-center md:text-left">
          <h1 className="pixel text-5xl tracking-[0.25em] sm:text-6xl">DEPTHS</h1>
          <p className="text-lg opacity-80">Bayar masuk. Makin dalam, makin kaya. Tapi kalau mati, hilang semua.</p>
          <div className="inline-block rounded-lg border-2 border-gold/40 bg-gold/5 px-6 py-4">
            <PoolBadge pool={info?.[0] ?? null} />
          </div>
          <div>
            <Link
              href="/play"
              className="pixel inline-block rounded bg-red-800 px-6 py-4 text-lg hover:bg-red-700"
              style={{ animation: 'heartbeat 1.4s ease-in-out infinite' }}
            >
              ENTER THE DUNGEON — {fee !== undefined ? mon(fee) : '1.000'} MON
            </Link>
          </div>
        </div>
        <LiveFeed items={items} loading={loading} />
      </section>

      <section className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Total run" value={stats.runs === null ? '…' : String(stats.runs)} />
        <Stat label="Kematian (terbaru)" value={loading ? '…' : String(items.filter((i) => i.kind === 'death').length)} />
        <Stat label="Lantai terdalam" value={stats.deepest === null ? '…' : stats.deepest ? String(stats.deepest) : '-'} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded border border-line bg-panel p-4">
            <div className="pixel text-teal">
              {i + 1}. {s.title}
            </div>
            <p className="mt-2 text-sm opacity-80">{s.text}</p>
          </div>
        ))}
      </section>

      <footer className="text-xs opacity-50">
        Testnet saja. Hasil acak dari blockhash masa depan (commit → reveal), bag selalu dibayar ke wallet utama. Aset: 0x72
        DungeonTileset II (CC0).
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-panel p-3">
      <div className="text-[10px] uppercase tracking-widest opacity-60">{label}</div>
      <div className="pixel mt-1 text-xl">{value}</div>
    </div>
  );
}

export function feedLine(i: FeedItem): string {
  if (i.kind === 'cashOut') return `${shortAddr(i.owner)} cash out ${mon(i.amount)} MON dari Lantai ${i.floor}`;
  if (i.kind === 'death') return `${shortAddr(i.owner)} mati di Lantai ${i.floor} (−${mon(i.amount)} MON)`;
  return `${shortAddr(i.owner)} memasuki dungeon`;
}

function LiveFeed({ items, loading }: { items: FeedItem[]; loading: boolean }) {
  return (
    <div className="rounded border border-line bg-panel p-3">
      <div className="pixel mb-2 text-xs text-teal">LIVE FEED</div>
      <ul className="h-64 space-y-1 overflow-y-auto text-xs">
        {loading && <li className="opacity-50">Mendengarkan dungeon…</li>}
        {!loading && items.length === 0 && <li className="opacity-50">Sepi. Jadilah yang pertama turun.</li>}
        {items.map((i) => (
          <li key={i.key} className={i.kind === 'death' ? 'text-red-400' : i.kind === 'cashOut' ? 'text-emerald-300' : 'opacity-70'}>
            {feedLine(i)}
          </li>
        ))}
      </ul>
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
