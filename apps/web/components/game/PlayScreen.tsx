'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useSwitchChain } from 'wagmi';
import { Action, RunState } from 'game-logic';
import { activeChain } from '@/lib/chains';
import { depthsAbi, depthsAddress, type OnchainRun } from '@/lib/contracts';
import { monsterName } from '@/lib/log';
import { isInstant, type Purchase } from '@/lib/runMachine';
import { buildScene, eventLine, hpAt, type SceneEvent } from '@/lib/scene';
import { gameStore, useGame } from '@/store/game';
import { usePoolInfo } from '@/components/feed/useDepthsFeed';
import { CombatLog } from './CombatLog';
import { DecisionModal } from './DecisionModal';
import { DungeonScene, type SceneMode } from './DungeonScene';
import { EncounterCard } from './EncounterCard';
import { CashOutScreen, DeathScreen } from './EndScreens';
import { EnterPanel } from './EnterPanel';
import { SessionPanel } from './SessionPanel';
import { DepthMeter, PoolBadge, StatsHud } from './StatsHud';
import { TxTicker } from './TxTicker';
import { useBattleTimeline, useReducedMotion } from './useBattleTimeline';
import { useDepthsGame } from './useDepthsGame';

/** Ambang banner "koneksi lambat" (UI_UX §6): > 200 blok sejak target dan belum ter-relay. */
const SLOW_WARN_BLOCKS = 200n;

type Busy = null | 'act' | 'cash' | 'deeper' | 'reap';
const NO_EVENTS: SceneEvent[] = [];

/** Halaman /play (UI_UX §3.2): scene, HUD, encounter, decision modal, log, TxTicker. */
export function PlayScreen() {
  const { isConnected } = useAccount();
  const game = useDepthsGame();
  const reduced = useReducedMotion();
  const phase = useGame((s) => s.phase);
  const snapshot = useGame((s) => s.snapshot);
  const ended = useGame((s) => s.ended);
  const txs = useGame((s) => s.txs);
  const log = useGame((s) => s.log);
  const error = useGame((s) => s.error);
  const balance = useGame((s) => s.sessionBalance);
  const [busy, setBusy] = useState<Busy>(null);
  const [committing, setCommitting] = useState(false);
  const best = useBestFloor(game, snapshot?.run.runId ?? 0, ended);

  const run = snapshot?.run ?? null;
  // sebelum wallet terhubung, pool tetap terlihat dari pembacaan publik (UI_UX §1.3)
  const publicPool = usePoolInfo(10_000);
  const pool = snapshot?.pool[0] ?? publicPool?.[0] ?? null;

  // aksi yang dikirim: tahan stance sampai fase meninggalkan encounter (UI_UX §2.4)
  useEffect(() => {
    if (phase.kind !== 'encounter') setCommitting(false);
  }, [phase.kind]);

  // ---------------------------------------------------------------- timeline resolusi lantai ini
  // Scene menempel pada run/ruangan tempat ia dimulai sampai selesai diputar: settle kematian bisa
  // masuk chain (fase → noRun) sebelum animasi selesai, dan animasinya tidak boleh terpotong.
  const resolving = phase.kind === 'resolved' || phase.kind === 'dying';
  const battleKey = resolving && run ? `${run.runId}:${run.floor}:${run.targetBlock}` : null;
  const [scene, setScene] = useState<{ key: string; events: SceneEvent[]; run: OnchainRun } | null>(null);
  useEffect(() => {
    if (!battleKey || !run || (phase.kind !== 'resolved' && phase.kind !== 'dying')) return;
    if (scene?.key === battleKey) return;
    const award = phase.kind === 'resolved' ? phase.award : 0n;
    setScene({ key: battleKey, run, events: buildScene({ run, resolution: phase.resolution, replay: phase.replay, award }) });
  }, [battleKey, run, phase, scene?.key]);
  const timeline = useBattleTimeline(scene?.events.length ? scene.key : null, scene?.events ?? NO_EVENTS, reduced);
  const playing = !!scene && scene.events.length > 0 && !timeline.done;
  const current = scene && (scene.key === battleKey || playing) ? scene : null;
  const events = current?.events ?? NO_EVENTS;
  const sceneRun = current?.run ?? run;
  const lastEvent = events[events.length - 1];
  const outcomeText = lastEvent?.type === 'outcome' ? lastEvent.text : undefined;
  const foe = sceneRun && sceneRun.pendingAction === Action.OPEN ? 'Mimic' : monsterName(sceneRun?.monsterId ?? 0);

  // log mengikuti timeline: baris live selama diputar, lalu dipindah ke log permanen
  const persisted = useRef(new Set<string>());
  useEffect(() => {
    if (!timeline.done || !scene || persisted.current.has(scene.key)) return;
    persisted.current.add(scene.key);
    for (const e of scene.events) {
      const line = eventLine(e, foe);
      if (line) gameStore.getState().pushLog(line, e.type === 'outcome' ? (e.good ? 'good' : 'bad') : undefined);
    }
  }, [timeline.done, scene, foe]);
  const live =
    playing && scene && !persisted.current.has(scene.key)
      ? events
          .slice(0, timeline.index + 1)
          .map((e) => eventLine(e, foe))
          .filter((l): l is string => !!l)
      : [];

  // ---------------------------------------------------------------- HP / bag yang mengikuti timeline
  const shown = useMemo(() => {
    if (!sceneRun) return { hp: 0, bag: 0n };
    if (!events.length) {
      if (phase.kind === 'resolved') {
        return { hp: phase.resolution.hpAfter, bag: sceneRun.bag + phase.award - phase.resolution.bagLoss };
      }
      return { hp: sceneRun.hp, bag: sceneRun.bag };
    }
    const upto = timeline.index;
    const hp = upto < 0 ? sceneRun.hp : hpAt(events, upto, { hero: sceneRun.hp, monster: null }).hero;
    let bag = sceneRun.bag;
    events.slice(0, upto + 1).forEach((e) => {
      if (e.type === 'loot') bag += e.amount;
      if (e.type === 'trapLoot') bag -= e.amount;
    });
    return { hp, bag };
  }, [sceneRun, events, timeline.index, phase]);

  // ---------------------------------------------------------------- mode scene
  const mode: SceneMode = (() => {
    if (playing) return 'battle';
    if (!snapshot) return 'empty';
    switch (phase.kind) {
      case 'noRun':
        return ended && ended.kind !== 'cashOut' ? 'dead' : 'empty';
      case 'waitReveal':
        return 'fog';
      case 'encounter':
        return committing ? 'stance' : 'encounter';
      case 'waitResolve':
        return 'stance';
      case 'resolved':
        return 'decision';
      case 'dying':
        return 'dead';
      case 'cleared':
        return 'decision';
      case 'expired':
        return 'expired';
    }
  })();
  const roomRun = playing ? sceneRun : run;
  const activeRoom = !!roomRun && roomRun.state !== RunState.NONE;
  const floor = (activeRoom ? roomRun.floor : 0) || ended?.floor || 1;
  const encounter = !playing && phase.kind === 'encounter' ? phase.encounter : (roomRun?.encounter ?? 0);
  const monsterId = !playing && phase.kind === 'encounter' ? phase.monsterId : (roomRun?.monsterId ?? 0);
  const roomKey = activeRoom ? `${roomRun.runId}:${roomRun.floor}` : 'lobby';
  const caption =
    mode === 'fog' ? 'Something stirs in the dark…' : mode === 'stance' ? 'Kamu dan lawanmu saling mengukur…' : undefined;

  // ---------------------------------------------------------------- aksi
  async function act(action: number, usePotion: boolean, buy: Purchase) {
    if (!game.machine) return;
    setCommitting(!isInstant(action));
    setBusy('act');
    try {
      const rec = await game.machine.act(action, usePotion, buy);
      if (rec.status !== 'success') setCommitting(false);
    } finally {
      setBusy(null);
    }
  }
  async function decide(kind: 'cash' | 'deeper' | 'reap') {
    if (!game.machine) return;
    setBusy(kind);
    try {
      if (kind === 'cash') await game.machine.cashOut();
      else if (kind === 'deeper') await game.machine.descend();
      else await game.machine.reap();
    } finally {
      setBusy(null);
    }
  }

  const pending = run && (run.state === RunState.AWAIT_REVEAL || run.state === RunState.AWAIT_SETTLE);
  const slow = !!snapshot && !!pending && phase.kind !== 'expired' && snapshot.block > run.targetBlock + SLOW_WARN_BLOCKS;
  const decisionOpen = mode === 'decision' && run && (phase.kind === 'resolved' || phase.kind === 'cleared');

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="pixel text-2xl tracking-[0.3em]">DEPTHS</h1>
        <DepthMeter floor={run?.floor ?? 0} best={best} />
        <PoolBadge pool={pool} />
        <ConnectButton chainStatus="icon" showBalance={false} />
      </header>

      {error && <Toast text={error} />}
      {slow && (
        <div className="flex items-center justify-between gap-2 rounded border border-danger bg-red-950 p-2 text-sm">
          <span>Koneksi lambat — selesaikan langkah ini atau run hangus.</span>
          <button className="rounded bg-danger px-2 py-0.5" onClick={() => game.machine?.refresh()}>
            Coba lagi
          </button>
        </div>
      )}

      <DungeonScene
        floor={floor}
        roomKey={roomKey}
        encounter={encounter}
        monsterId={monsterId}
        mode={mode}
        events={events}
        timeline={timeline}
        swords={roomRun?.swords ?? 0}
        reducedMotion={reduced}
        caption={caption}
      >
        {!isConnected && (
          <Center>
            <p className="pixel mb-3 text-lg">Bayar masuk. Makin dalam, makin kaya.</p>
            <ConnectButton />
          </Center>
        )}
        {isConnected && game.wrongChain && (
          <Center>
            <WrongChain />
          </Center>
        )}
        {isConnected && !game.wrongChain && !playing && phase.kind === 'noRun' && snapshot && !ended && (
          <Center>
            <EnterPanel game={game} />
          </Center>
        )}
        {!playing && phase.kind === 'noRun' && ended?.kind === 'cashOut' && (
          <CashOutScreen floor={ended.floor} amount={ended.amount} onAgain={() => gameStore.getState().setEnded(null)} />
        )}
        {!playing && phase.kind === 'noRun' && ended && ended.kind !== 'cashOut' && (
          <DeathScreen
            floor={ended.floor}
            lost={ended.amount}
            cause={ended.kind === 'expired' ? 'expired' : 'killed'}
            onRetry={() => gameStore.getState().setEnded(null)}
          />
        )}
        {phase.kind === 'dying' && timeline.done && run && <DeathScreen floor={run.floor} lost={run.bag} cause="killed" pending />}
        {phase.kind === 'expired' && run && (
          <DeathScreen floor={run.floor} lost={run.bag} cause="expired" onReap={() => decide('reap')} busy={busy === 'reap'} />
        )}
        {decisionOpen && run && pool !== null && (
          <DecisionModal
            floor={run.floor}
            bag={shown.bag}
            hp={shown.hp}
            maxHp={run.maxHp}
            pool={pool}
            outcome={outcomeText}
            busy={busy === 'cash' ? 'cash' : busy === 'deeper' ? 'deeper' : null}
            reducedMotion={reduced}
            onCashOut={() => decide('cash')}
            onDeeper={() => decide('deeper')}
          />
        )}
        {mode === 'battle' && (
          <button
            className="pixel absolute bottom-2 right-2 z-10 rounded bg-black/60 px-2 py-1 text-xs hover:bg-black/80"
            onClick={timeline.skip}
          >
            SKIP [Space]
          </button>
        )}
      </DungeonScene>

      {isConnected && !game.wrongChain && (
        <div className="grid gap-3 md:grid-cols-[1fr_17rem]">
          <section className="min-h-28 rounded border border-line bg-panel p-3">
            {phase.kind === 'encounter' && run && pool !== null ? (
              <EncounterCard
                key={roomKey}
                run={run}
                encounter={phase.encounter}
                monsterId={phase.monsterId}
                pool={pool}
                busy={busy !== null || committing}
                onAct={act}
              />
            ) : (
              <StatusLine mode={mode} />
            )}
          </section>
          <aside className="space-y-3 rounded border border-line bg-panel p-3">
            {run && run.state !== RunState.NONE ? (
              <StatsHud
                hp={shown.hp}
                maxHp={run.maxHp}
                atk={run.atk}
                potions={run.potions}
                swords={run.swords}
                shields={run.shields}
                bag={shown.bag}
              />
            ) : (
              <p className="text-sm opacity-60">Belum ada run aktif.</p>
            )}
            <SessionPanel game={game} balance={balance} runActive={!!run && run.state !== RunState.NONE} />
          </aside>
          <section className="rounded border border-line bg-panel p-3 md:col-span-2">
            <CombatLog log={log} live={live} />
          </section>
        </div>
      )}

      <footer className="rounded border border-line bg-panel p-2">
        <TxTicker txs={txs} />
      </footer>
    </main>
  );
}

function StatusLine({ mode }: { mode: SceneMode }) {
  const text: Partial<Record<SceneMode, string>> = {
    fog: 'Kamu menuruni tangga. Sesuatu menunggu di bawah…',
    stance: 'Langkahmu terkunci di chain. Menunggu takdir dari blok berikutnya…',
    battle: 'Pertarungan berlangsung. Tekan Space untuk melewati.',
    decision: 'Lantai clear. Cash out, atau turun lebih dalam?',
    dead: 'Gelap.',
    expired: 'Run ini hangus.',
    empty: 'Pintu dungeon terbuka.',
  };
  return <p className="text-sm italic opacity-70">{text[mode] ?? ''}</p>;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center md:absolute md:z-20 bg-black/50 p-3">
      <div className="w-full max-w-md rounded-lg border-2 border-line bg-panel/95 p-5">{children}</div>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  useEffect(() => {
    const t = setTimeout(() => gameStore.getState().setError(null), 6000);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div className="fixed right-3 top-3 z-50 flex max-w-sm items-start gap-2 rounded border border-danger bg-red-950 p-2 text-sm shadow-lg">
      <span className="break-words">{text}</span>
      <button className="opacity-70" onClick={() => gameStore.getState().setError(null)}>
        ✕
      </button>
    </div>
  );
}

function WrongChain() {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <div className="text-center">
      <p className="mb-3">Dungeon ini ada di {activeChain.name}.</p>
      <button
        className="pixel rounded bg-yellow-700 px-4 py-2 disabled:opacity-40"
        disabled={isPending}
        onClick={() => switchChain({ chainId: activeChain.id })}
      >
        Switch to {activeChain.name}
      </button>
    </div>
  );
}

/** Lantai terdalam owner dari `stats` on-chain, dibaca ulang saat run berganti / selesai. */
function useBestFloor(game: ReturnType<typeof useDepthsGame>, runId: number, ended: unknown): number {
  const [best, setBest] = useState(0);
  useEffect(() => {
    if (!game.owner) return;
    let alive = true;
    game.client
      .readContract({ address: depthsAddress(), abi: depthsAbi, functionName: 'stats', args: [game.owner] })
      .then(([, bestFloor]) => alive && setBest(bestFloor))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [game.owner, game.client, runId, ended]);
  return best;
}
