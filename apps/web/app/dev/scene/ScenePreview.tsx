'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { keccak256, toHex, type Hex } from 'viem';
import { Action, Encounter, MONSTER_NAMES, Outcome, RunState, monster, replayCombat, type Resolution } from 'game-logic';
import { DecisionModal } from '@/components/game/DecisionModal';
import { DungeonScene, type SceneMode } from '@/components/game/DungeonScene';
import { EncounterCard } from '@/components/game/EncounterCard';
import { CashOutScreen, DeathScreen } from '@/components/game/EndScreens';
import { StatsHud } from '@/components/game/StatsHud';
import { useBattleTimeline, useReducedMotion, type TimelineState } from '@/components/game/useBattleTimeline';
import type { OnchainRun } from '@/lib/contracts';
import { buildScene, eventLine, type SceneEvent } from '@/lib/scene';

const ACTION_FOR: Record<number, number> = {
  [Encounter.MONSTER]: Action.FIGHT,
  [Encounter.TREASURE]: Action.OPEN,
  [Encounter.TRAP]: Action.PROCEED,
  [Encounter.MERCHANT]: Action.LEAVE,
};

function fixture(floor: number, enc: number, mid: number, seedN: number, action: number): { run: OnchainRun; events: SceneEvent[] } {
  const seed: Hex = keccak256(toHex(`depths-preview-${seedN}`));
  const run: OnchainRun = {
    operator: '0x0000000000000000000000000000000000000001',
    runId: 1,
    state: RunState.AWAIT_SETTLE,
    floor,
    encounter: enc,
    pendingAction: action,
    swords: 0,
    shields: 0,
    potions: 0,
    usePotion: false,
    hp: 100,
    maxHp: 100,
    atk: 12,
    monsterId: mid,
    targetBlock: 1n,
    bag: 0n,
    encounterSeed: seed,
  };
  const kind = action === Action.FIGHT ? 'fight' : action === Action.FLEE ? 'flee' : action === Action.OPEN ? 'open' : null;
  const replay = kind ? replayCombat({ seed, kind, floor, hp: run.hp, maxHp: run.maxHp, atk: run.atk, usePotion: false }) : null;
  let resolution: Resolution = replay?.result ?? { outcome: Outcome.TRAP_HP, survived: true, hpAfter: 100 - (10 + 3 * floor), lootTable: 0n, bagLoss: 0n };
  if (action === Action.DISARM) resolution = { outcome: Outcome.DISARM_FAIL, survived: true, hpAfter: 100 - 2 * (10 + 3 * floor), lootTable: 0n, bagLoss: 0n };
  if (enc === Encounter.MERCHANT) return { run, events: [] };
  return { run, events: buildScene({ run, resolution, replay, award: resolution.lootTable }) };
}

export function ScenePreview() {
  const q = useSearchParams();
  const [floor, setFloor] = useState(Number(q.get('floor') ?? 1));
  const [enc, setEnc] = useState(Number(q.get('enc') ?? Encounter.MONSTER));
  const [mid, setMid] = useState(Number(q.get('mid') ?? 0));
  const [mode, setMode] = useState<SceneMode>((q.get('mode') as SceneMode) ?? 'encounter');
  const [seedN, setSeedN] = useState(Number(q.get('seed') ?? 1));
  const [swords, setSwords] = useState(Number(q.get('swords') ?? 0));
  const [play, setPlay] = useState(0);
  const freeze = q.get('freeze');
  const action = Number(q.get('action') ?? ACTION_FOR[enc]);
  const overlay = q.get('overlay');
  const POOL = 84n * 10n ** 18n;
  const reduced = useReducedMotion();
  const { events, run } = useMemo(() => fixture(floor, enc, mid, seedN, action), [floor, enc, mid, seedN, action]);
  const live = useBattleTimeline(mode === 'battle' && freeze === null ? `p${play}` : null, events, reduced);
  const frozen: TimelineState | null =
    freeze !== null
      ? { index: Number(freeze), stage: 'impact', done: false, current: events[Number(freeze)] ?? null, skip: () => {} }
      : null;
  const timeline = frozen ?? live;

  return (
    <main className="mx-auto max-w-5xl space-y-3 p-4 text-sm">
      <h1 className="pixel text-xl">Scene preview (dev)</h1>
      <div className="flex flex-wrap gap-3">
        <label>
          floor <input type="number" min={1} max={20} value={floor} onChange={(e) => setFloor(Number(e.target.value))} className="w-14 bg-panel" />
        </label>
        <label>
          encounter{' '}
          <select value={enc} onChange={(e) => setEnc(Number(e.target.value))} className="bg-panel">
            <option value={1}>monster</option>
            <option value={2}>treasure</option>
            <option value={3}>trap</option>
            <option value={4}>merchant</option>
          </select>
        </label>
        <label>
          monster{' '}
          <select value={mid} onChange={(e) => setMid(Number(e.target.value))} className="bg-panel">
            {MONSTER_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {i} {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          mode{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as SceneMode)} className="bg-panel">
            {['empty', 'fog', 'encounter', 'stance', 'battle', 'decision', 'dead'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          seed <input type="number" value={seedN} onChange={(e) => setSeedN(Number(e.target.value))} className="w-14 bg-panel" />
        </label>
        <label>
          swords <input type="number" min={0} max={5} value={swords} onChange={(e) => setSwords(Number(e.target.value))} className="w-12 bg-panel" />
        </label>
        <button className="rounded bg-teal-800 px-2" onClick={() => setPlay((p) => p + 1)}>
          replay
        </button>
        <button className="rounded bg-neutral-700 px-2" onClick={live.skip}>
          skip
        </button>
      </div>
      <DungeonScene
        floor={floor}
        roomKey={`${floor}:${enc}:${mid}`}
        encounter={enc}
        monsterId={mid}
        mode={mode}
        events={events}
        timeline={timeline}
        swords={swords}
        reducedMotion={reduced}
        caption={mode === 'fog' ? 'Something stirs in the dark…' : undefined}
      >
        {overlay === 'decision' && (
          <DecisionModal floor={floor} bag={2_400_000_000_000_000_000n} hp={64} maxHp={140} pool={POOL} outcome="Menang! Loot +1.400 MON." busy={null} reducedMotion={reduced} onCashOut={() => {}} onDeeper={() => {}} />
        )}
        {overlay === 'death' && <DeathScreen floor={floor} lost={4_200_000_000_000_000_000n} cause="killed" onRetry={() => {}} />}
        {overlay === 'cashout' && <CashOutScreen floor={floor} amount={6_800_000_000_000_000_000n} onAgain={() => {}} />}
      </DungeonScene>
      <div className="grid gap-3 md:grid-cols-[1fr_17rem]">
        <section className="rounded border border-line bg-panel p-3">
          <EncounterCard run={{ ...run, state: RunState.AWAIT_ACTION, bag: 1_600_000_000_000_000_000n, potions: 1 }} encounter={enc} monsterId={mid} pool={POOL} busy={false} onAct={() => {}} />
        </section>
        <aside className="rounded border border-line bg-panel p-3">
          <StatsHud hp={64} maxHp={140} atk={32} potions={1} swords={2} shields={2} bag={1_600_000_000_000_000_000n} />
        </aside>
      </div>
      <p className="opacity-70">
        {MONSTER_NAMES[mid]} · HP {monster(floor).hp} ATK {monster(floor).atk} · event {timeline.index + 1}/{events.length}
        {timeline.done ? ' · selesai' : ''}
      </p>
      <ol className="font-mono text-xs">
        {events.slice(0, timeline.index + 1).map((e, i) => (
          <li key={i}>{eventLine(e, MONSTER_NAMES[mid] ?? '')}</li>
        ))}
      </ol>
    </main>
  );
}
