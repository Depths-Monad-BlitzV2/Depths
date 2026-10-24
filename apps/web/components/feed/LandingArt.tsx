import type { CSSProperties } from 'react';
import { MONSTER_NAMES, monster } from 'game-logic';
import { SpriteActor } from '@/components/game/SpriteActor';
import { mon } from '@/lib/log';
import { MONSTER_SPRITES, SPRITES, TIER_THEMES, TILE_URL } from '@/lib/sprites';

// Dekorasi landing (UI_UX §3.1). Murni CSS + atlas 0x72, tanpa state, jadi tetap server component
// dan tidak menambah JS client. Semua elemen dekoratif aria-hidden.

/** Obor dinding: gagang, api berlapis, dan cahaya yang berkedip. */
export function Torch({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute h-24 w-10 ${className ?? ''}`} style={style}>
      <div
        className="motion-ambient absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 -translate-y-1/3 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(251,146,60,0.35) 0%, rgba(251,146,60,0.08) 45%, transparent 70%)',
          mixBlendMode: 'screen',
          animation: 'torch-flicker 1.6s ease-in-out infinite',
        }}
      />
      <div
        className="motion-ambient absolute left-1/2 top-1 h-10 w-6 origin-bottom"
        style={{
          background: 'radial-gradient(ellipse at 50% 80%, #fff7c2 0%, #fbbf24 30%, #f97316 60%, transparent 72%)',
          borderRadius: '50% 50% 45% 45% / 65% 65% 35% 35%',
          animation: 'flame 0.5s ease-in-out infinite',
        }}
      />
      <div
        className="motion-ambient absolute left-1/2 top-4 h-6 w-3 origin-bottom"
        style={{
          background: 'radial-gradient(ellipse at 50% 80%, #ffffff 0%, #fde68a 50%, transparent 75%)',
          borderRadius: '50%',
          animation: 'flame 0.35s ease-in-out infinite reverse',
        }}
      />
      <div className="absolute left-1/2 top-10 h-3 w-5 -translate-x-1/2 border-2 border-black bg-[#6b4a2b]" />
      <div className="absolute left-1/2 top-12 h-10 w-2 -translate-x-1/2 border-x-2 border-b-2 border-black bg-[#4a3220]" />
    </div>
  );
}

// Posisi bara dibuat tetap supaya HTML server identik di setiap render.
const EMBERS = [
  { left: 6, delay: 0, dur: 7, drift: 30, size: 3 },
  { left: 14, delay: 2.4, dur: 9, drift: -20, size: 2 },
  { left: 23, delay: 4.1, dur: 8, drift: 25, size: 3 },
  { left: 31, delay: 1.2, dur: 10, drift: -35, size: 2 },
  { left: 42, delay: 5.5, dur: 7.5, drift: 15, size: 2 },
  { left: 55, delay: 3.3, dur: 9.5, drift: -25, size: 3 },
  { left: 63, delay: 0.8, dur: 8.5, drift: 30, size: 2 },
  { left: 71, delay: 6.2, dur: 7, drift: -15, size: 3 },
  { left: 80, delay: 2.9, dur: 10, drift: 20, size: 2 },
  { left: 88, delay: 4.7, dur: 8, drift: -30, size: 3 },
  { left: 95, delay: 1.7, dur: 9, drift: 10, size: 2 },
];

/** Bara api yang naik pelan dari lantai. */
export function Embers() {
  return (
    <div aria-hidden className="motion-ember pointer-events-none absolute inset-0 overflow-hidden">
      {EMBERS.map((e) => (
        <span
          key={e.left}
          className="absolute bottom-0 rounded-full bg-orange-400"
          style={
            {
              left: `${e.left}%`,
              width: e.size,
              height: e.size,
              boxShadow: '0 0 6px 2px rgba(251,146,60,0.7)',
              opacity: 0,
              animation: `ember-rise ${e.dur}s linear ${e.delay}s infinite`,
              '--drift': `${e.drift}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Tile berulang dari pack 0x72 pada skala integer. */
export function TileFill({ tile, scale = 3, className, style }: { tile: string; scale?: number; className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      className={`pixelated absolute ${className ?? ''}`}
      style={{ backgroundImage: `url(${TILE_URL(tile)})`, backgroundSize: `${16 * scale}px ${16 * scale}px`, ...style }}
    />
  );
}

/** Pilar batu dari tile `column` (16×48). */
export function Column({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pixelated absolute h-[144px] w-[48px] ${className ?? ''}`}
      style={{ backgroundImage: `url(${TILE_URL('column')})`, backgroundSize: '48px 144px', backgroundRepeat: 'no-repeat' }}
    />
  );
}

// Nama zona kosmetik per tier, warnanya mengikuti TIER_THEMES di scene game.
const ZONES = [
  { name: 'Lorong Atas', floors: [1, 3] },
  { name: 'Gua Lumut', floors: [4, 6] },
  { name: 'Katakomba', floors: [7, 10] },
  { name: 'Jurang Abyss', floors: [11, 20] },
] as const;

/** Peta kedalaman: 4 tier, monster, dan rentang loot tabel (GAME_DESIGN §4.1). */
export function DepthMap() {
  return (
    <div className="space-y-2 md:col-start-1 md:row-start-1">
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 className="pixel text-xl text-gold sm:text-2xl">PETA KEDALAMAN</h2>
        <span className="text-xs text-foreground/70">Makin dalam, makin kaya. Makin mematikan.</span>
      </div>
      {ZONES.map((z, tier) => {
        const theme = TIER_THEMES[tier]!;
        const [lo, hi] = z.floors;
        const darkness = 0.35 + tier * 0.15;
        return (
          <div key={z.name}>
            <div className="stone relative isolate overflow-hidden" style={{ minHeight: 104 }}>
              <TileFill tile={theme.floor} scale={2} className="inset-0 -z-20" />
              <div className="absolute inset-0 -z-10" style={{ background: theme.tint, mixBlendMode: 'color', opacity: 0.7 }} />
              <div
                className="absolute inset-0 -z-10"
                style={{ background: `linear-gradient(90deg, rgba(5,4,10,0.92) 0%, rgba(5,4,10,0.7) 45%, rgba(5,4,10,${darkness}) 100%)` }}
              />
              <div
                aria-hidden
                className="absolute -right-8 top-1/2 -z-10 h-40 w-40 -translate-y-1/2 rounded-full"
                style={{ background: `radial-gradient(circle, ${theme.light}40 0%, transparent 70%)` }}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="pixel text-[11px] tracking-widest" style={{ color: theme.light }}>
                    LANTAI {lo}–{hi}
                  </div>
                  <div className="pixel mt-1 text-lg">{z.name}</div>
                  <div className="mt-1 text-xs text-foreground/80">
                    Loot <span className="text-gold">{mon(monster(lo).loot)}–{mon(monster(hi).loot)} MON</span> per monster
                  </div>
                </div>
                <ul className="flex items-end gap-3">
                  {MONSTER_SPRITES.slice(tier * 4, tier * 4 + 4).map((m, i) => {
                    const scale = SPRITES[m.idle].w > 16 ? 2 : 3;
                    return (
                      <li key={i} title={MONSTER_NAMES[tier * 4 + i]} className="flex flex-col items-center">
                        <span className="sr-only">{MONSTER_NAMES[tier * 4 + i]}</span>
                        <div className="motion-ambient" style={{ animation: `bob 2.4s ease-in-out ${i * 0.3}s infinite` }}>
                          <SpriteActor sprite={m.idle} scale={scale} flip filter={m.filter} />
                        </div>
                        <div aria-hidden className="mt-1 h-1.5 w-8 rounded-full bg-black/60 blur-[2px]" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
            {tier < ZONES.length - 1 && (
              <div aria-hidden className="pixel py-1 text-center text-xs text-foreground/40">
                ▼
              </div>
            )}
          </div>
        );
      })}
      <p className="pt-1 text-[11px] text-foreground/70">Loot aktual dibatasi 5% prize pool. Lantai terdalam: 20.</p>
    </div>
  );
}
