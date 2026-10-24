'use client';

import { MAX_POTIONS, MAX_SHIELDS, MAX_SWORDS, POTION_PRICE, SHIELD_PRICE, SWORD_PRICE } from 'game-logic';
import { mon } from '@/lib/log';
import type { Purchase } from '@/lib/runMachine';

export function purchaseCost(p: Purchase): bigint {
  return BigInt(p.swords) * SWORD_PRICE + BigInt(p.shields) * SHIELD_PRICE + BigInt(p.potions) * POTION_PRICE;
}

/** Stepper qty per item, total harga, sisa bag setelah beli (UI_UX §3.2). Belanja masuk ke pool. */
export function MerchantPanel(props: {
  bag: bigint;
  owned: Purchase;
  value: Purchase;
  onChange: (p: Purchase) => void;
}) {
  const { bag, owned, value, onChange } = props;
  const cost = purchaseCost(value);
  const rows: { key: keyof Purchase; icon: string; name: string; effect: string; price: bigint; max: number }[] = [
    { key: 'swords', icon: '🗡️', name: 'Sword', effect: '+10 ATK', price: SWORD_PRICE, max: MAX_SWORDS - owned.swords },
    { key: 'shields', icon: '🛡️', name: 'Shield', effect: '+20 max HP & HP', price: SHIELD_PRICE, max: MAX_SHIELDS - owned.shields },
    { key: 'potions', icon: '🧪', name: 'Potion', effect: '+50 HP saat dipakai', price: POTION_PRICE, max: MAX_POTIONS - owned.potions },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const v = value[r.key];
        const canAdd = v < r.max && cost + r.price <= bag;
        return (
          <div key={r.key} className="flex items-center gap-2 text-sm">
            <button
              className="pixel h-7 w-7 rounded border border-line disabled:opacity-30"
              disabled={v <= 0}
              onClick={() => onChange({ ...value, [r.key]: v - 1 })}
              aria-label={`kurangi ${r.name}`}
            >
              −
            </button>
            <span className="pixel w-4 text-center">{v}</span>
            <button
              className="pixel h-7 w-7 rounded border border-line disabled:opacity-30"
              disabled={!canAdd}
              onClick={() => onChange({ ...value, [r.key]: v + 1 })}
              aria-label={`tambah ${r.name}`}
            >
              +
            </button>
            <span>
              {r.icon} {r.name} <span className="opacity-60">({r.effect})</span>
            </span>
            <span className="pixel ml-auto text-gold">{mon(r.price)}</span>
          </div>
        );
      })}
      <div className="flex justify-between border-t border-line pt-2 text-sm">
        <span>
          Total <span className="pixel text-gold">{mon(cost)}</span>
        </span>
        <span className="opacity-70">
          Sisa bag <span className="pixel">{mon(bag >= cost ? bag - cost : 0n)}</span>
        </span>
      </div>
      {bag === 0n && (
        <p className="text-xs text-gold/80">
          Bag masih kosong. Bag hanya terisi dari loot (monster, peti, salvage jebakan). Pilih LEAVE untuk lanjut.
        </p>
      )}
    </div>
  );
}
