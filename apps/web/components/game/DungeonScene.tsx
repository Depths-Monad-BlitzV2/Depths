'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Encounter, tierOf } from 'game-logic';
import { mon } from '@/lib/log';
import type { SceneEvent } from '@/lib/scene';
import { SPRITES, TIER_THEMES, TILE_URL, monsterSprite, swordSprite, type SpriteKey } from '@/lib/sprites';
import { SpriteActor } from './SpriteActor';
import type { TimelineState } from './useBattleTimeline';

// Battle scene side-view (UI_UX §2.1–2.4). Kanvas logis 320×180, di-scale integer (×1–×4) mengikuti
// lebar container. Layer: background tier → prop → aktor → efek → vignette. Semua tile dan sprite ×2
// supaya kerapatan pixel seragam.

export const SCENE_W = 320;
export const SCENE_H = 180;
const PX = 2; // skala sprite/tile di kanvas logis
const WALL_H = 96;
const FEET_Y = 156;
const HERO_HOME = 64;
const HERO_FIGHT = 118;
const FOE_HOME = 250;
const FOE_FIGHT = 206;
const TRAP_X = 160;

export type SceneMode =
  | 'empty' // belum ada run
  | 'fog' // menunggu blok target setelah enter/descend
  | 'encounter' // encounter tampil, menunggu aksi
  | 'stance' // aksi dikirim / menunggu blok target: maju dan bersiap, tanpa hit
  | 'battle' // timeline diputar
  | 'decision' // lantai clear, menunggu keputusan
  | 'dead'
  | 'expired';

export interface DungeonSceneProps {
  floor: number;
  /** `runId:floor`; berubah = ruangan baru (transisi tangga + walk-in). */
  roomKey: string;
  encounter: number;
  monsterId: number;
  mode: SceneMode;
  events: SceneEvent[];
  timeline: TimelineState;
  swords: number;
  reducedMotion: boolean;
  /** Teks overlay kecil (mis. "Something stirs in the dark…"). */
  caption?: string;
  children?: ReactNode;
}

/** Skala integer terbesar yang muat di container (min 1, maks 4). */
function useIntegerScale(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(2);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? SCENE_W * 2;
      setK(Math.max(1, Math.min(4, Math.floor(w / SCENE_W))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, k];
}

interface Floater {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  big?: boolean;
}

export function DungeonScene(props: DungeonSceneProps) {
  const { floor, roomKey, encounter, monsterId, mode, events, timeline, swords, reducedMotion, caption, children } = props;
  const [ref, k] = useIntegerScale();
  const theme = TIER_THEMES[floor > 0 ? tierOf(floor) : 0]!;
  const { index, stage, current } = timeline;
  const upto = (pred: (e: SceneEvent) => boolean) => events.slice(0, index + 1).some(pred);

  // ---------------------------------------------------------------- state aktor dari timeline
  const battle = mode === 'battle' || mode === 'decision' || mode === 'dead';
  const fighting = mode === 'stance' || battle;
  // recovery di FLOOR_CLEARED tidak punya timeline: monster sudah tidak ada di ruangan
  const foeDead =
    upto((e) => e.type === 'win') || (mode === 'decision' && events.length === 0 && encounter === Encounter.MONSTER);
  const heroDead = upto((e) => e.type === 'dead' || e.type === 'roundLimit') || mode === 'dead' || mode === 'expired';
  const fled = upto((e) => e.type === 'flee' && e.ok);
  const mimicRevealed = upto((e) => e.type === 'chestOpen' && e.mimic);
  const chestOpened = upto((e) => e.type === 'chestOpen');
  const trapSprung = upto((e) => e.type === 'trapHp' || (e.type === 'disarm' && !e.ok));
  const kneeling = current?.type === 'disarm';

  const heroLunge = current?.type === 'playerHit' && stage === 'windup';
  const foeLunge = current?.type === 'monsterHit' && stage === 'windup';
  const heroHurt =
    stage === 'impact' &&
    (current?.type === 'monsterHit' || current?.type === 'trapHp' || (current?.type === 'disarm' && !current.ok));
  const foeHurt = stage === 'impact' && current?.type === 'playerHit';

  let heroX = fighting ? HERO_FIGHT : HERO_HOME;
  if (encounter === Encounter.TRAP && fighting) heroX = TRAP_X - 22;
  if (heroLunge) heroX += 18;
  if (fled) heroX = -60;

  const foeIsMonster = encounter === Encounter.MONSTER || mimicRevealed;
  let foeX = foeIsMonster && fighting ? FOE_FIGHT : FOE_HOME;
  if (foeLunge) foeX -= 18;

  // ---------------------------------------------------------------- efek
  const shakeAnim =
    heroHurt && !reducedMotion ? `${index % 2 ? 'shake' : 'shake-b'} 180ms linear` : undefined;
  const floaters: Floater[] = [];
  events.slice(0, index + 1).forEach((e, i) => {
    if (i === index && stage === 'windup') return;
    const id = `${roomKey}:${i}`;
    const heroTop = FEET_Y - 56 - 6;
    switch (e.type) {
      case 'playerHit':
        floaters.push({ id, text: `-${e.damage}${e.strong ? '!' : ''}`, x: FOE_FIGHT, y: FEET_Y - 70, color: '#ffffff', big: e.strong });
        break;
      case 'monsterHit':
        floaters.push({ id, text: `-${e.damage}${e.strong ? '!' : ''}`, x: heroX, y: heroTop, color: '#ef4444', big: e.strong });
        break;
      case 'potion':
        floaters.push({ id, text: `+${e.heal}`, x: heroX, y: heroTop, color: '#4ade80' });
        break;
      case 'trapHp':
        floaters.push({ id, text: `-${e.damage}`, x: heroX, y: heroTop, color: '#ef4444' });
        break;
      case 'disarm':
        floaters.push({ id, text: e.ok ? 'klik!' : `-${e.damage}`, x: heroX, y: heroTop, color: e.ok ? '#2dd4bf' : '#ef4444' });
        break;
      case 'trapLoot':
        floaters.push({ id, text: `-${mon(e.amount)} MON`, x: heroX, y: heroTop, color: '#fbbf24' });
        break;
      case 'loot':
        floaters.push({ id, text: `+${mon(e.amount)} MON`, x: SCENE_W / 2, y: 70, color: '#fbbf24', big: true });
        break;
      case 'flee':
        floaters.push({ id, text: e.ok ? 'kabur!' : 'gagal kabur!', x: HERO_FIGHT, y: heroTop, color: '#e6e3f0' });
        break;
      default:
        break;
    }
  });
  const coins = index >= 0 && current?.type === 'loot' && stage === 'impact';

  // ---------------------------------------------------------------- vignette per kedalaman (UI_UX §2)
  const depth = Math.min(floor, 20) / 20;
  const vignette = `radial-gradient(ellipse at center, transparent ${55 - depth * 25}%, rgba(0,0,0,${0.55 + depth * 0.4}) 100%)`;

  const heroSprite: SpriteKey = heroHurt ? 'heroHit' : mode === 'fog' && !heroDead ? 'heroRun' : 'heroIdle';
  const ms = (n: number) => (reducedMotion ? Math.round(n / 2) : n);

  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded border border-line bg-black" style={{ height: SCENE_H * k }}>
      <div
        className="absolute left-1/2 top-0 origin-top"
        style={{ width: SCENE_W, height: SCENE_H, transform: `translateX(-50%) scale(${k})` }}
      >
        <div className="absolute inset-0 overflow-hidden" style={{ animation: shakeAnim }}>
          {/* background tier */}
          <Tiles x={0} y={0} w={SCENE_W} h={32} tile="wall_top_mid" />
          <Tiles x={0} y={32} w={SCENE_W} h={WALL_H - 32} tile={theme.wall} />
          <Tiles x={0} y={WALL_H} w={SCENE_W} h={SCENE_H - WALL_H} tile={theme.floor} />
          <div className="absolute inset-0" style={{ background: theme.tint, mixBlendMode: 'color', opacity: 0.55 }} />
          {/* prop dinding */}
          <Tiles x={0} y={0} w={32} h={WALL_H + 8} tile="column" size={[32, 96]} />
          <Tiles x={SCENE_W - 32} y={0} w={32} h={WALL_H + 8} tile="column" size={[32, 96]} />
          <Tiles x={72} y={40} w={32} h={32} tile={theme.banner} />
          <Tiles x={SCENE_W - 104} y={40} w={32} h={32} tile={theme.banner} />
          {theme.fountain && (
            <>
              <Prop sprite={theme.fountain === 'red' ? 'fountainMidRed' : 'fountainMidBlue'} x={SCENE_W / 2} y={64} />
              <Prop sprite={theme.fountain === 'red' ? 'fountainBasinRed' : 'fountainBasinBlue'} x={SCENE_W / 2} y={96} />
            </>
          )}
          <Torch x={88} color={theme.light} />
          <Torch x={SCENE_W - 88} color={theme.light} />

          {/* prop encounter */}
          {encounter === Encounter.TRAP && floor > 0 && (
            <Prop
              key={`trap-${roomKey}-${trapSprung}`}
              sprite="spikes"
              x={TRAP_X}
              y={FEET_Y + 4}
              once={trapSprung}
              paused={!trapSprung}
            />
          )}
          {encounter === Encounter.MERCHANT && floor > 0 && <Prop sprite="crate" x={FOE_HOME - 34} y={FEET_Y} />}

          {/* aktor: hero */}
          {floor > 0 && (
            <div
              key={`hero-${roomKey}`}
              className="absolute"
              style={{
                left: heroX - 16,
                top: FEET_Y - 56,
                transition: `left ${fled ? ms(600) : ms(heroLunge ? 110 : 450)}ms ease-out, transform 500ms, opacity 600ms`,
                transform: heroDead ? 'rotate(-90deg) translate(-20px, 4px)' : kneeling ? 'translateY(6px)' : undefined,
                opacity: heroDead ? 0.6 : 1,
                filter: heroDead ? 'grayscale(1)' : undefined,
                animation: mode === 'fog' || mode === 'encounter' ? `walk-in-left ${ms(700)}ms ease-out` : undefined,
              }}
            >
              <SpriteActor sprite={heroSprite} scale={PX} flip={fled} />
              <Sword swords={swords} swing={heroLunge} hidden={heroDead || fled} />
              {current?.type === 'potion' && <Prop sprite="flaskGreen" x={16} y={-4} />}
            </div>
          )}

          {/* aktor: lawan / prop kanan */}
          {floor > 0 && mode !== 'fog' && mode !== 'empty' && (
            <div
              key={`foe-${roomKey}`}
              className="absolute"
              style={{
                left: foeX,
                top: FEET_Y,
                transition: `left ${ms(foeLunge ? 110 : 450)}ms ease-out, opacity ${ms(600)}ms, transform ${ms(600)}ms`,
                opacity: foeDead ? 0 : 1,
                transform: foeDead ? 'translateY(10px)' : undefined,
                animation: `walk-in-right ${ms(600)}ms ease-out`,
              }}
            >
              <Foe
                encounter={encounter}
                monsterId={monsterId}
                hurt={foeHurt}
                flashName={index % 2 ? 'hit-flash' : 'hit-flash-b'}
                chestOpened={chestOpened}
                mimic={mimicRevealed}
                rattling={current?.type === 'chestOpen' && current.mimic}
              />
            </div>
          )}

          {/* efek */}
          {floaters.map((f) => (
            <div
              key={f.id}
              className="pixel absolute whitespace-nowrap"
              style={{
                left: f.x,
                top: f.y,
                color: f.color,
                fontSize: f.big ? 14 : 10,
                textShadow: '1px 1px 0 #000',
                animation: `float-up ${ms(900)}ms ease-out forwards`,
              }}
            >
              {f.text}
            </div>
          ))}
          {coins &&
            [0, 1, 2, 3, 4].map((i) => (
              <div
                key={`coin-${roomKey}-${i}`}
                className="absolute"
                style={{ left: 150 + i * 6, top: 110 - (i % 2) * 6, animation: `float-to-bag ${ms(700 + i * 60)}ms ease-in forwards` }}
              >
                <SpriteActor sprite="coin" scale={PX} />
              </div>
            ))}
        </div>

        {/* kabut saat menunggu blok target (UI_UX §6) */}
        {mode === 'fog' && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 20% 70%, rgba(180,170,220,0.18), transparent 40%), radial-gradient(circle at 70% 60%, rgba(180,170,220,0.14), transparent 45%)',
              backgroundSize: '320px 180px',
              animation: reducedMotion ? undefined : 'fog-drift 6s linear infinite',
            }}
          />
        )}
        {/* vignette makin tebal per lantai */}
        <div className="pointer-events-none absolute inset-0" style={{ background: vignette }} />
        {floor >= 11 && <div className="pointer-events-none absolute inset-0" style={{ background: 'rgba(120,0,0,0.12)' }} />}

        {/* transisi tangga per lantai baru */}
        {floor > 0 && (
          <div
            key={`stairs-${roomKey}`}
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black"
            style={{ animation: `stairs-dark ${ms(1400)}ms ease-in-out forwards`, opacity: 0 }}
          >
            <span className="pixel text-sm text-foreground">LANTAI {floor}</span>
          </div>
        )}

        {caption && (
          <div className="pixel pointer-events-none absolute inset-x-0 bottom-2 text-center text-[8px] text-foreground/80">
            {caption}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Tiles({ x, y, w, h, tile, size }: { x: number; y: number; w: number; h: number; tile: string; size?: [number, number] }) {
  return (
    <div
      className="pixelated absolute"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        backgroundImage: `url(${TILE_URL(tile)})`,
        backgroundSize: size ? `${size[0]}px ${size[1]}px` : `${16 * PX}px ${16 * PX}px`,
        backgroundRepeat: size ? 'no-repeat' : 'repeat',
      }}
    />
  );
}

/** Prop dari atlas, diposisikan dengan titik bawah-tengah di (x, y). */
function Prop({ sprite, x, y, once, paused, style }: { sprite: SpriteKey; x: number; y: number; once?: boolean; paused?: boolean; style?: CSSProperties }) {
  const a = SPRITES[sprite];
  return (
    <div className="absolute" style={{ left: x - (a.w * PX) / 2, top: y - a.h * PX, ...style }}>
      <SpriteActor sprite={sprite} scale={PX} once={once} paused={paused} />
    </div>
  );
}

function Torch({ x, color }: { x: number; color: string }) {
  return (
    <div
      className="pointer-events-none absolute rounded-full"
      style={{
        left: x - 40,
        top: 16,
        width: 80,
        height: 80,
        background: `radial-gradient(circle, ${color}66 0%, transparent 70%)`,
        mixBlendMode: 'screen',
        animation: 'torch-flicker 1.6s ease-in-out infinite',
      }}
    />
  );
}

/** Overlay pedang: 3 varian sesuai jumlah sword (UI_UX §2.5). */
function Sword({ swords, swing, hidden }: { swords: number; swing: boolean; hidden: boolean }) {
  if (hidden) return null;
  const key = swordSprite(swords);
  const a = SPRITES[key];
  return (
    <div
      className="absolute"
      style={{
        left: 20,
        top: 14,
        transformOrigin: `${(a.w * PX) / 2}px ${a.h * PX - 4}px`,
        transform: `rotate(${swing ? 95 : 25}deg)`,
        transition: 'transform 100ms',
        filter: swords >= 3 ? 'drop-shadow(0 0 3px #ff7a2a)' : undefined,
      }}
    >
      <SpriteActor sprite={key} scale={PX} />
    </div>
  );
}

function Foe(props: {
  encounter: number;
  monsterId: number;
  hurt: boolean;
  flashName: string;
  chestOpened: boolean;
  mimic: boolean;
  rattling: boolean;
}) {
  const { encounter, monsterId, hurt, flashName, chestOpened, mimic, rattling } = props;
  const anchor = (w: number, h: number, node: ReactNode, style?: CSSProperties) => (
    <div className="absolute" style={{ left: -w / 2, top: -h, ...style }}>
      {node}
    </div>
  );
  const flash: CSSProperties | undefined = hurt ? { animation: `${flashName} 160ms linear` } : undefined;

  if (encounter === Encounter.MONSTER) {
    const s = monsterSprite(monsterId);
    const a = SPRITES[s.idle];
    return anchor(a.w * s.scale, a.h * s.scale, <SpriteActor sprite={s.idle} scale={s.scale} flip filter={s.filter} />, flash);
  }
  if (encounter === Encounter.TREASURE) {
    if (mimic) {
      return anchor(48, 48, <SpriteActor sprite="chestMimic" scale={3} once flip />, flash);
    }
    return anchor(
      32,
      32,
      <SpriteActor key={String(chestOpened)} sprite="chestFull" scale={PX} once={chestOpened} paused={!chestOpened} />,
      rattling ? { animation: 'chest-rattle 120ms linear infinite' } : undefined,
    );
  }
  if (encounter === Encounter.MERCHANT) {
    return anchor(32, 46, <SpriteActor sprite="merchant" scale={PX} flip />);
  }
  return null;
}
