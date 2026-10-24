import Link from 'next/link';
import { FeedIsland, FeeIsland, PoolIsland } from './LandingIslands';

const STEPS = [
  { title: 'Bayar', text: '1 MON masuk dungeon. Satu popup wallet, sisanya otomatis.' },
  { title: 'Turun', text: 'Tiap lantai: monster, peti, jebakan, atau pedagang. Acak dari blok masa depan.' },
  { title: 'Pilih', text: 'Setelah lantai clear: bawa pulang bag, atau turun lebih dalam.' },
  { title: 'Cash out atau mati', text: 'Mati = bag-mu jadi prize pool untuk pemain berikutnya.' },
];

/**
 * Landing (UI_UX §3.1). Server component: hero, CTA, dan how it works jadi HTML statis; pool, fee,
 * live feed, dan statistik adalah island client yang dimuat lazy.
 */
export function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 p-4 sm:p-8">
      <nav className="flex items-center justify-between text-sm">
        <span className="pixel tracking-[0.3em]">DEPTHS</span>
        <Link href="/leaderboard" className="text-foreground/80 hover:text-foreground">
          Leaderboard
        </Link>
      </nav>

      <section className="grid items-start gap-8 md:grid-cols-[1fr_20rem]">
        <div className="space-y-5 text-center md:col-start-1 md:row-start-1 md:text-left">
          <h1 className="pixel text-5xl tracking-[0.25em] sm:text-6xl">DEPTHS</h1>
          <p className="text-lg text-foreground/85">Bayar masuk. Makin dalam, makin kaya. Tapi kalau mati, hilang semua.</p>
          <div className="inline-block rounded-lg border-2 border-gold/40 bg-gold/5 px-6 py-4">
            <PoolIsland />
          </div>
          <div>
            <Link
              href="/play"
              className="pixel inline-block rounded bg-red-800 px-6 py-4 text-lg hover:bg-red-700"
              style={{ animation: 'heartbeat 1.4s ease-in-out infinite' }}
            >
              ENTER THE DUNGEON — <FeeIsland /> MON
            </Link>
          </div>
        </div>
        <FeedIsland />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded border border-line bg-panel p-4">
            <div className="pixel text-teal">
              {i + 1}. {s.title}
            </div>
            <p className="mt-2 text-sm text-foreground/85">{s.text}</p>
          </div>
        ))}
      </section>

      <footer className="text-xs text-foreground/70">
        Testnet saja. Hasil acak dari blockhash masa depan (commit → reveal), bag selalu dibayar ke wallet utama. Aset: 0x72
        DungeonTileset II (CC0).
      </footer>
    </main>
  );
}
