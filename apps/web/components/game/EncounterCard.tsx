'use client';

import { useState } from 'react';
import { Action, Encounter, MMON, POTION_HEAL, fleeChance, mimicFloor, monster } from 'game-logic';
import type { OnchainRun } from '@/lib/contracts';
import { encounterLine, mon, monsterName } from '@/lib/log';
import { cappedAward, isInstant, validActions, type Purchase } from '@/lib/runMachine';
import { MerchantPanel, purchaseCost } from './MerchantPanel';
import { useWinChance } from './useWinChance';

const LABEL: Record<number, string> = {
  [Action.FIGHT]: 'FIGHT',
  [Action.FLEE]: 'FLEE',
  [Action.OPEN]: 'OPEN',
  [Action.LEAVE]: 'LEAVE',
  [Action.PROCEED]: 'PROCEED',
  [Action.DISARM]: 'DISARM',
  [Action.BUY]: 'BUY',
};

const HINT: Partial<Record<number, string>> = {
  [Action.FIGHT]: 'Bertarung sampai salah satu tumbang.',
  [Action.OPEN]: 'Buka peti. 5% kemungkinan mimic.',
  [Action.LEAVE]: 'Lewati, lantai clear tanpa risiko.',
  [Action.PROCEED]: 'Jalan terus: kehilangan HP (tidak fatal) atau 20% bag.',
  [Action.DISARM]: 'Jinakkan: salvage MON, atau gagal dan bisa fatal.',
  [Action.BUY]: 'Bayar dari bag. MON yang dibelanjakan masuk pool.',
};

/** Info encounter dan tombol aksi valid (CONTRACT_SPEC §4, UI_UX §3.2). */
export function EncounterCard(props: {
  run: OnchainRun;
  encounter: number;
  monsterId: number;
  pool: bigint;
  busy: boolean;
  onAct: (action: number, usePotion: boolean, buy: Purchase) => void;
}) {
  const { run, encounter, monsterId, pool, busy, onAct } = props;
  const [usePotion, setUsePotion] = useState(false);
  const [buy, setBuy] = useState<Purchase>({ swords: 0, shields: 0, potions: 0 });
  const floor = run.floor;
  const hpWithPotion = usePotion ? Math.min(run.maxHp, run.hp + POTION_HEAL) : run.hp;
  const m = encounter === Encounter.MONSTER ? monster(floor) : null;
  const win = useWinChance(
    m ? { playerHp: hpWithPotion, playerAtk: run.atk, monsterHp: m.hp, monsterAtk: m.atk, monsterFirst: false } : null,
  );
  const cost = purchaseCost(buy);

  return (
    <div className="space-y-3">
      <p className="text-base">{encounterLine(encounter, monsterId)}</p>

      {m && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Stat label={monsterName(monsterId)} value={`HP ${m.hp}`} />
          <Stat label="ATK" value={String(m.atk)} danger />
          <Stat label="Loot" value={`${mon(cappedAward(m.loot, pool))} MON`} gold />
          <Stat label="Win chance" value={win === null ? '…' : `≈ ${Math.round(win * 100)}%`} hint="estimasi 500 simulasi" />
        </div>
      )}
      {encounter === Encounter.TREASURE && (
        <p className="text-sm opacity-80">
          Isi 0.150–0.600 MON. 5% mimic (stat lantai {mimicFloor(floor)}), kalau menang loot{' '}
          {mon(cappedAward(monster(floor).loot * 2n, pool))} MON.
        </p>
      )}
      {encounter === Encounter.TRAP && (
        <p className="text-sm opacity-80">
          PROCEED: 60% −{10 + 3 * floor} HP (tidak fatal), 40% kehilangan 20% bag. DISARM: 50% salvage{' '}
          {mon(cappedAward(BigInt(100 * floor) * MMON, pool))} MON, 50% −{2 * (10 + 3 * floor)} HP
          {2 * (10 + 3 * floor) >= run.hp ? ' (FATAL untuk HP-mu sekarang)' : ''}.
        </p>
      )}
      {encounter === Encounter.MERCHANT && (
        <MerchantPanel
          bag={run.bag}
          owned={{ swords: run.swords, shields: run.shields, potions: run.potions }}
          value={buy}
          onChange={setBuy}
        />
      )}

      {run.potions > 0 && encounter !== Encounter.MERCHANT && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={usePotion} onChange={(e) => setUsePotion(e.target.checked)} disabled={busy} />
          🧪 Minum potion dulu (+{POTION_HEAL} HP, sisa {run.potions})
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {validActions(encounter).map((a) => {
          const danger = a === Action.FIGHT || a === Action.DISARM || a === Action.OPEN;
          return (
            <button
              key={a}
              title={HINT[a]}
              className={`pixel rounded px-5 py-2 text-sm disabled:opacity-40 ${
                danger ? 'bg-red-800 hover:bg-red-700' : 'bg-neutral-700 hover:bg-neutral-600'
              }`}
              disabled={busy || (a === Action.BUY && (cost === 0n || cost > run.bag))}
              onClick={() => onAct(a, usePotion && !isInstant(a), buy)}
            >
              {LABEL[a]}
              {a === Action.FLEE ? ` ${fleeChance(floor)}%` : ''}
              {a === Action.BUY && cost > 0n ? ` ${mon(cost)}` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, danger, gold, hint }: { label: string; value: string; danger?: boolean; gold?: boolean; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[10px] uppercase tracking-widest opacity-60">{label}</div>
      <div className={`pixel ${danger ? 'text-danger' : gold ? 'text-gold' : ''}`}>{value}</div>
    </div>
  );
}
