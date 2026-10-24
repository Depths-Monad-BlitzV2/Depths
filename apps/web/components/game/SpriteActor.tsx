import type { CSSProperties } from 'react';
import { ATLAS_SIZE, ATLAS_URL, SPRITES, type SpriteKey } from '@/lib/sprites';

export interface SpriteActorProps {
  sprite: SpriteKey;
  /** Skala integer di kanvas logis (UI_UX §2.1: tanpa scale pecahan). */
  scale?: number;
  /** Hadap kiri (sprite pack menghadap kanan). */
  flip?: boolean;
  filter?: string;
  /** Putar sekali lalu berhenti di frame terakhir (mis. peti terbuka). */
  once?: boolean;
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Satu aktor dari atlas via CSS: background-position + steps() (UI_UX §2.1).
 * Frame ke-i ada di x + i × stride; animasi menggeser background-position-x sejauh frames × stride.
 */
export function SpriteActor({ sprite, scale = 2, flip, filter, once, paused, className, style }: SpriteActorProps) {
  const a = SPRITES[sprite];
  const stride = a.stride ?? a.w;
  const animated = a.frames > 1 && !paused;
  const duration = a.frames / a.fps;
  const sx0 = -a.x * scale;
  const sx1 = -(a.x + a.frames * stride) * scale;
  // sekali jalan: berhenti di frame terakhir, bukan lewat satu frame
  const sxEnd = -(a.x + (a.frames - 1) * stride) * scale;
  const vars = {
    '--sx0': `${sx0}px`,
    '--sx1': `${once ? sxEnd : sx1}px`,
  } as CSSProperties;

  return (
    <div
      className={`pixelated ${className ?? ''}`}
      aria-hidden
      style={{
        width: a.w * scale,
        height: a.h * scale,
        backgroundImage: `url(${ATLAS_URL})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${ATLAS_SIZE * scale}px ${ATLAS_SIZE * scale}px`,
        backgroundPositionX: `${paused && once ? sxEnd : sx0}px`,
        backgroundPositionY: `${-a.y * scale}px`,
        animation: animated
          ? once
            ? `sprite-play ${duration}s steps(${a.frames - 1}) forwards`
            : `sprite-play ${duration}s steps(${a.frames}) infinite`
          : undefined,
        transform: flip ? 'scaleX(-1)' : undefined,
        filter,
        ...vars,
        ...style,
      }}
    />
  );
}
