import Link from 'next/link';
import { SpriteActor } from '@/components/game/SpriteActor';
import type { SpriteKey } from '@/lib/sprites';
import { Column, DepthMap, Embers, TileFill, Torch } from './LandingArt';
import { FeedIsland, FeeIsland, PoolIsland } from './LandingIslands';

const STEPS: { title: string; text: string; icon: SpriteKey }[] = [
  { title: 'Bayar', text: '1 MON masuk dungeon. Satu popup wallet, sisanya otomatis.', icon: 'coin' },
  { title: 'Turun', text: 'Tiap lantai: monster, peti, jebakan, atau pedagang. Acak dari blok masa depan.', icon: 'heroRun' },
  { title: 'Pilih', text: 'Setelah lantai clear: bawa pulang bag, atau turun lebih dalam.', icon: 'chestFull' },
  { title: 'Cash out atau mati', text: 'Mati = bag-mu jadi prize pool untuk pemain berikutnya.', icon: 'skull' },
];

const PROMISES = ['Acak dari blok masa depan', 'Bag selalu dibayar ke wallet-mu', 'Tanpa admin yang bisa tarik pool'];

/**
 * Landing (UI_UX §3.1). Server component: hero, CTA, dan how it works jadi HTML statis; pool, fee,
 * live feed, dan statistik adalah island client yang dimuat lazy. Dekorasi dari LandingArt (CSS saja).
 */
export function Landing() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <Hero />

      <section className="mx-auto grid max-w-5xl gap-6 px-4 py-12 sm:px-8 md:grid-cols-[1fr_20rem]">
        <DepthMap />
        <FeedIsland />
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-12 sm:px-8">
        <h2 className="pixel mb-4 text-xl text-gold sm:text-2xl">CARA MAIN</h2>
        <ol className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="stone relative p-4 pt-5">
              <span aria-hidden className="pixel absolute right-3 top-2 text-3xl text-foreground/10">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex h-12 items-end">
                <SpriteActor sprite={s.icon} scale={s.icon === 'coin' || s.icon === 'skull' ? 5 : s.icon === 'heroRun' ? 2 : 3} />
              </div>
              <div className={`pixel mt-3 ${i === STEPS.length - 1 ? 'text-red-400' : 'text-teal'}`}>
                {i + 1}. {s.title}
              </div>
              <p className="mt-2 text-sm text-foreground/85">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <FinalCall />

      <footer className="mx-auto max-w-5xl px-4 py-6 text-xs text-foreground/70 sm:px-8">
        Testnet saja. Hasil acak dari blockhash masa depan (commit → reveal), bag selalu dibayar ke wallet utama. Aset: 0x72
        DungeonTileset II (CC0).
      </footer>
    </main>
  );
}

/** Gerbang dungeon: dinding batu, obor, judul, prize pool, dan CTA di atas lantai dengan aktor. */
function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b-4 border-black">
      {/* dinding batu + cahaya hangat di tengah, gelap di tepi dan bawah */}
      <TileFill tile="wall_top_mid" className="inset-x-0 top-0 -z-30 h-12" />
      <TileFill tile="wall_mid" className="inset-x-0 bottom-0 top-12 -z-30" />
      <div
        aria-hidden
        className="absolute inset-0 -z-20"
        style={{
          background:
            'radial-gradient(ellipse 60% 55% at 50% 38%, rgba(60,30,20,0.35) 0%, rgba(11,10,18,0.82) 70%, rgba(11,10,18,0.96) 100%)',
        }}
      />
      <Column className="left-4 top-12 -z-10 hidden opacity-80 md:block" />
      <Column className="right-4 top-12 -z-10 hidden opacity-80 md:block" />
      <TileFill tile="wall_banner_red" className="left-[14%] top-20 -z-10 hidden h-12 w-12 opacity-90 lg:block" />
      <TileFill tile="wall_banner_red" className="right-[14%] top-20 -z-10 hidden h-12 w-12 opacity-90 lg:block" />
      <Torch className="left-[8%] top-40 -z-10 hidden sm:block" />
      <Torch className="right-[8%] top-40 -z-10 hidden sm:block" />
      <Embers />

      <nav className="relative mx-auto flex max-w-5xl items-center justify-between px-4 py-4 text-sm sm:px-8">
        <span className="pixel tracking-[0.3em] text-foreground/90">DEPTHS</span>
        <Link href="/leaderboard" className="pixel text-xs text-foreground/80 hover:text-gold">
          LEADERBOARD →
        </Link>
      </nav>

      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 pb-6 pt-8 text-center sm:pt-12">
        <span className="pixel rounded-sm border border-teal/40 bg-black/50 px-3 py-1 text-[10px] tracking-widest text-teal">
          ON-CHAIN ROGUELIKE · MONAD TESTNET
        </span>
        <h1 className="title-depths pixel mt-5 text-6xl font-bold tracking-[0.18em] sm:text-8xl">DEPTHS</h1>
        <p className="mt-4 max-w-xl text-lg text-foreground/90">
          Bayar masuk. Makin dalam, makin kaya. <span className="text-red-400">Tapi kalau mati, hilang semua.</span>
        </p>

        <div className="stone mt-7 flex items-center gap-4 px-5 py-3">
          <div className="relative">
            <SpriteActor sprite="chestFull" scale={3} paused />
            <div className="motion-ambient absolute -right-2 -top-2" style={{ animation: 'bob 1.8s ease-in-out infinite' }}>
              <SpriteActor sprite="coin" scale={3} />
            </div>
          </div>
          <div className="[&>div]:text-left! [&_.pixel]:text-2xl sm:[&_.pixel]:text-3xl">
            <PoolIsland />
          </div>
        </div>

        <Link
          href="/play"
          className="btn-blood pixel motion-ambient mt-7 inline-block rounded-sm px-7 py-4 text-base text-white sm:text-lg"
          style={{ animation: 'heartbeat 1.4s ease-in-out infinite' }}
        >
          ENTER THE DUNGEON — <FeeIsland /> MON
        </Link>

        <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-foreground/75">
          {PROMISES.map((p) => (
            <li key={p}>
              <span aria-hidden className="text-teal">◆ </span>
              {p}
            </li>
          ))}
        </ul>
      </div>

      <HeroFloor />
    </section>
  );
}

/** Lantai depan gerbang: knight siap turun, tangga ke jurang, monster mengintai di gelap. */
function HeroFloor() {
  return (
    <div aria-hidden className="relative h-40 sm:h-44">
      <TileFill tile="floor_1" className="inset-0 -z-10" />
      <div
        className="absolute inset-0 -z-10"
        style={{ background: 'linear-gradient(180deg, rgba(11,10,18,0.55) 0%, rgba(11,10,18,0.25) 40%, rgba(11,10,18,0.9) 100%)' }}
      />
      <div
        className="absolute inset-y-0 right-0 -z-10 w-2/3"
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(5,4,10,0.85) 60%, #05040a 100%)' }}
      />
      {/* jurang di tengah */}
      <div
        className="motion-ambient absolute bottom-6 left-1/2 h-16 w-48 rounded-[50%]"
        style={{
          background: 'radial-gradient(ellipse, #000 35%, rgba(124,58,237,0.45) 60%, transparent 75%)',
          animation: 'abyss-pulse 3s ease-in-out infinite',
        }}
      />
      <div
        className="pixel motion-ambient absolute bottom-24 left-1/2 -ml-10 w-20 text-center text-[10px] text-violet-300/80"
        style={{ animation: 'bob 2s ease-in-out infinite' }}
      >
        LANTAI 1 ▼
      </div>

      <div className="relative mx-auto h-full max-w-5xl">
        {/* hero */}
        <div className="absolute bottom-8 left-[10%] sm:left-[18%]">
          <SpriteActor sprite="heroIdle" scale={4} />
          <div className="mx-auto -mt-1 h-2 w-12 rounded-full bg-black/60 blur-[2px]" />
        </div>
        <div className="absolute bottom-9 left-[calc(10%+76px)] hidden sm:left-[calc(18%+76px)] sm:block">
          <SpriteActor sprite="flaskRed" scale={3} />
        </div>

        {/* monster mengintai di kegelapan kanan */}
        <div className="absolute bottom-8 right-[24%] hidden sm:block" style={{ filter: 'brightness(0.55)' }}>
          <SpriteActor sprite="goblinIdle" scale={4} flip />
        </div>
        <div className="absolute bottom-8 right-[12%]" style={{ filter: 'brightness(0.4) saturate(1.3)' }}>
          <SpriteActor sprite="skeletIdle" scale={4} flip />
        </div>
        <div className="absolute bottom-8 right-0 hidden md:block" style={{ filter: 'brightness(0.5) saturate(1.3)' }}>
          <SpriteActor sprite="bigDemonIdle" scale={4} flip />
        </div>
      </div>
    </div>
  );
}

/** Ajakan penutup di dasar halaman: jurang dengan mata yang menunggu. */
function FinalCall() {
  return (
    <section className="relative isolate overflow-hidden border-y-4 border-black">
      <TileFill tile="floor_8" className="inset-0 -z-20" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(ellipse 70% 90% at 50% 100%, rgba(127,29,29,0.55) 0%, rgba(5,4,10,0.94) 65%)' }}
      />
      <Embers />
      <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-14 text-center">
        <div aria-hidden className="mb-4 flex items-end gap-6" style={{ filter: 'brightness(0.6)' }}>
          <SpriteActor sprite="skull" scale={4} />
          <SpriteActor sprite="chestMimic" scale={4} paused />
          <SpriteActor sprite="skull" scale={4} flip />
        </div>
        <h2 className="pixel text-2xl sm:text-3xl">Pool sedang menunggu.</h2>
        <p className="mt-2 text-foreground/80">Yang mati sebelum kamu sudah mengisinya. Berani turun?</p>
        <Link href="/play" className="btn-blood pixel mt-6 inline-block rounded-sm px-7 py-4 text-base text-white sm:text-lg">
          TURUN SEKARANG — <FeeIsland /> MON
        </Link>
      </div>
    </section>
  );
}
