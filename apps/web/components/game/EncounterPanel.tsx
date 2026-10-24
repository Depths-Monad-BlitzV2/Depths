'use client';

import { useState } from 'react';
import {
  Action,
  Encounter,
  MAX_POTIONS,
  MAX_SHIELDS,
  MAX_SWORDS,
  MMON,
  POTION_PRICE,
  SHIELD_PRICE,
  SWORD_PRICE,
  fleeChance,
  monster,
} from 'game-logic';
import { encounterLine, mon, monsterName } from '@/lib/log';
import { actionName, cappedAward, isInstant, validActions, type Phase, type Purchase } from '@/lib/runMachine';
import { useGame } from '@/store/game';
import type { DepthsGame } from './useDepthsGame';

type EncounterPhase = Extract<Phase, { kind: 'encounter' }>;

const LABEL: Record<number, string> = {
  [Action.FIGHT]: 'FIGHT',
  [Action.FLEE]: 'FLEE',
  [Action.OPEN]: 'OPEN',
  [Action.LEAVE]: 'LEAVE',
  [Action.PROCEED]: 'PROCEED',
  [Action.DISARM]: 'DISARM',
  [Action.BUY]: 'BUY',
};

/** Info encounter + tombol aksi valid (CONTRACT_SPEC §4). */
export function EncounterPanel({ game, phase }: { game: DepthsGame; phase: EncounterPhase }) {
  const snapshot = useGame((s) => s.snapshot);
  const [usePotion, setUsePotion] = useState(false);
  const [buy, setBuy] = useState<Purchase>({ swords: 0, shields: 0, potions: 0 });
  const [busy, setBusy] = useState(false);
  if (!snapshot) return null;
  const run = snapshot.run;
  const pool = snapshot.pool[0];
  const floor = run.floor;

  async function act(action: number) {
    if (!game.machine) return;
    setBusy(true);
    try {
      await game.machine.act(action, usePotion && !isInstant(action) && run.potions > 0, buy);
    } finally {
      setBusy(false);
      setBuy({ swords: 0, shields: 0, potions: 0 });
      setUsePotion(false);
    }
  }

  const cost = BigInt(buy.swords) * SWORD_PRICE + BigInt(buy.shields) * SHIELD_PRICE + BigInt(buy.potions) * POTION_PRICE;

  return (
    <div className="space-y-3">
      <p className="text-lg">{encounterLine(phase.encounter, phase.monsterId)}</p>
      {phase.encounter === Encounter.MONSTER && <MonsterInfo floor={floor} monsterId={phase.monsterId} pool={pool} />}
      {phase.encounter === Encounter.TREASURE && (
        <p className="text-sm opacity-80">
          Isi 0.200–1.000 MON. 5% peluang mimic (stat lantai {Math.min(floor + 2, 20)}), menang = 2× loot lantai ini.
        </p>
      )}
      {phase.encounter === Encounter.TRAP && (
        <p className="text-sm opacity-80">
          PROCEED: 60% −{10 + 3 * floor} HP (tidak fatal), 40% kehilangan 20% bag. DISARM: 50% salvage{' '}
          {mon(cappedAward(BigInt(100 * floor) * MMON, pool))} MON, 50% −{2 * (10 + 3 * floor)} HP (bisa fatal).
        </p>
      )}
      {phase.encounter === Encounter.MERCHANT && (
        <div className="space-y-1 text-sm">
          <Stepper label={`🗡 Sword +10 ATK (${mon(SWORD_PRICE)})`} value={buy.swords} max={MAX_SWORDS - run.swords} onChange={(v) => setBuy({ ...buy, swords: v })} />
          <Stepper label={`🛡 Shield +20 HP (${mon(SHIELD_PRICE)})`} value={buy.shields} max={MAX_SHIELDS - run.shields} onChange={(v) => setBuy({ ...buy, shields: v })} />
          <Stepper label={`🧪 Potion +50 HP (${mon(POTION_PRICE)})`} value={buy.potions} max={MAX_POTIONS - run.potions} onChange={(v) => setBuy({ ...buy, potions: v })} />
          <p className={cost > run.bag ? 'text-red-400' : 'opacity-70'}>
            Total {mon(cost)} MON, sisa bag {mon(run.bag >= cost ? run.bag - cost : 0n)} MON
          </p>
          {run.bag === 0n && (
            <p className="text-amber-300">
              Bag masih kosong. Bag hanya terisi dari loot (monster, peti, salvage jebakan), lalu bisa dibelanjakan di
              sini. Pilih LEAVE untuk lanjut.
            </p>
          )}
        </div>
      )}
      {run.potions > 0 && phase.encounter !== Encounter.MERCHANT && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={usePotion} onChange={(e) => setUsePotion(e.target.checked)} />
          Minum potion dulu (+50 HP, sisa {run.potions})
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {validActions(phase.encounter).map((a) => (
          <button
            key={a}
            className="rounded bg-neutral-700 px-4 py-2 font-bold hover:bg-neutral-600 disabled:opacity-40"
            disabled={busy || (a === Action.BUY && (cost === 0n || cost > run.bag))}
            onClick={() => act(a)}
          >
            {LABEL[a] ?? actionName(a)}
            {a === Action.FLEE ? ` ${fleeChance(floor)}%` : ''}
          </button>
        ))}
      </div>
      {busy && <p className="text-sm opacity-60">Langkahmu bergema di lorong…</p>}
    </div>
  );
}

function MonsterInfo({ floor, monsterId, pool }: { floor: number; monsterId: number; pool: bigint }) {
  const m = monster(floor);
  return (
    <p className="text-sm opacity-80">
      {monsterName(monsterId)}: HP {m.hp}, ATK {m.atk}, loot {mon(cappedAward(m.loot, pool))} MON. Flee {fleeChance(floor)}%.
    </p>
  );
}

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button className="w-6 rounded bg-neutral-800 disabled:opacity-30" disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="w-4 text-center">{value}</span>
      <button className="w-6 rounded bg-neutral-800 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
      <span>{label}</span>
    </div>
  );
}
