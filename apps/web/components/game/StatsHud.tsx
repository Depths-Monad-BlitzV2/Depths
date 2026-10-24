'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_FLOOR } from 'game-logic';
import { mon } from '@/lib/log';
import { SpriteActor } from './SpriteActor';

/** HP bar + ATK + inventory + BAG (UI_UX §3.2). Nilai HP/BAG diberikan oleh timeline, bukan state sendiri. */
export function StatsHud(props: {
  hp: number;
  maxHp: number;
  atk: number;
  potions: number;
  swords: number;
  shields: number;
  bag: bigint;
}) {
  const { hp, maxHp, atk, potions, swords, shields, bag } = props;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  const color = pct > 50 ? 'bg-heal' : pct > 25 ? 'bg-gold' : 'bg-danger';
  return (
    <div className="space-y-3">
      <div>
        <div className="pixel flex justify-between text-xs">
          <span>❤ HP</span>
          <span>
            {hp} / {maxHp}
          </span>
        </div>
        <div className="mt-1 h-3 w-full overflow-hidden rounded-sm border border-line bg-black">
          <div className={`h-full ${color} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="pixel flex items-center gap-3 text-xs">
        <span>⚔ ATK {atk}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Item sprite="flaskRed" label="potion" n={potions} />
        <Badge icon="🗡️" n={swords} label="sword (+10 ATK)" />
        {/* pack tidak punya sprite perisai: fallback badge (UI_UX §2.5) */}
        <Badge icon="🛡️" n={shields} label="shield (+20 max HP)" />
      </div>
      <BagValue bag={bag} />
    </div>
  );
}

function Badge({ icon, n, label }: { icon: string; n: number; label: string }) {
  return (
    <span title={label} className={`pixel rounded border px-1.5 py-0.5 ${n ? 'border-teal text-teal' : 'border-line opacity-50'}`}>
      {icon} ×{n}
    </span>
  );
}

function Item({ sprite, label, n }: { sprite: 'flaskRed'; label: string; n: number }) {
  return (
    <span className={`flex items-center gap-1 ${n ? '' : 'opacity-50'}`} title={label}>
      <span className="inline-block h-[16px] w-[16px] overflow-hidden">
        <SpriteActor sprite={sprite} scale={1} />
      </span>
      <span className="pixel">×{n}</span>
    </span>
  );
}

/** Angka BAG dengan glow emas saat bertambah. */
function BagValue({ bag }: { bag: bigint }) {
  const prev = useRef(bag);
  const [glow, setGlow] = useState(0);
  useEffect(() => {
    if (bag > prev.current) setGlow((g) => g + 1);
    prev.current = bag;
  }, [bag]);
  return (
    <div className="rounded border border-gold/40 bg-gold/5 p-2">
      <div className="text-[10px] uppercase tracking-widest text-gold/70">Bag (dipertaruhkan)</div>
      <div key={glow} className="pixel text-xl text-gold" style={{ animation: glow ? 'count-up-glow 900ms ease-out' : undefined }}>
        {mon(bag)} MON
      </div>
    </div>
  );
}

/** Progres lantai 1–20 dengan penanda rekor pribadi. */
export function DepthMeter({ floor, best }: { floor: number; best: number }) {
  // panah mengikuti lantai sekarang; belum ada run (0) = mentok kiri. Tiap sel 8px + gap 2px.
  const arrowX = Math.max(0, Math.min(floor, MAX_FLOOR) - 1) * 10;
  return (
    <div className="flex items-center gap-2">
      <span className="pixel text-sm">FLOOR {floor || '-'}</span>
      <div className="relative flex gap-[2px]" aria-label={`lantai ${floor} dari ${MAX_FLOOR}, terdalam ${best}`}>
        <span
          aria-hidden
          className="absolute -top-2.5 w-2 text-center text-[8px] leading-none text-gold transition-[left] duration-500"
          style={{ left: arrowX }}
        >
          ▼
        </span>
        {Array.from({ length: MAX_FLOOR }, (_, i) => {
          const f = i + 1;
          const tone = f <= floor ? (f >= 11 ? 'bg-danger' : f >= 7 ? 'bg-purple-500' : 'bg-teal') : 'bg-line';
          return <div key={f} className={`h-3 w-2 ${tone}`} title={`Lantai ${f}`} />;
        })}
      </div>
    </div>
  );
}

/** Pool live, berdenyut saat naik (ada yang mati / belanja). */
export function PoolBadge({ pool }: { pool: bigint | null }) {
  const prev = useRef(pool);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (pool !== null && prev.current !== null && pool > prev.current) setBump((b) => b + 1);
    prev.current = pool;
  }, [pool]);
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-widest opacity-60">Prize pool</div>
      <div key={bump} className="pixel text-lg text-gold" style={{ animation: bump ? 'count-up-glow 1200ms ease-out' : undefined }}>
        {pool === null ? '…' : `${mon(pool)} MON`}
      </div>
    </div>
  );
}
