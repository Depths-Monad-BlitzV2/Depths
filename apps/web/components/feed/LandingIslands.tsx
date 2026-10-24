'use client';

import dynamic from 'next/dynamic';

// Island client untuk landing: modul yang membaca chain (viem, ABI) dimuat setelah HTML statis tampil,
// supaya tidak menahan LCP (Phase 6, Lighthouse).

export const PoolIsland = dynamic(() => import('./LandingLive').then((m) => m.PoolLive), {
  ssr: false,
  loading: () => (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-widest text-foreground/70">Prize pool</div>
      <div className="pixel text-lg text-gold">… MON</div>
    </div>
  ),
});

export const FeeIsland = dynamic(() => import('./LandingLive').then((m) => m.FeeLive), {
  ssr: false,
  loading: () => <>1.000</>,
});

export const FeedIsland = dynamic(() => import('./LandingLive').then((m) => m.FeedAndStats), {
  ssr: false,
  loading: () => (
    <div className="rounded border border-line bg-panel p-3 md:col-start-2 md:row-start-1">
      <div className="pixel mb-2 text-xs text-teal">LIVE FEED</div>
      <p className="h-64 text-xs text-foreground/70">Mendengarkan dungeon…</p>
    </div>
  ),
});
