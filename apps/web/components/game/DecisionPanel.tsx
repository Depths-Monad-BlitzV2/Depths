'use client';

import { useState } from 'react';
import { MAX_FLOOR, monster } from 'game-logic';
import { mon, outcomeLine } from '@/lib/log';
import { cappedAward, type Phase } from '@/lib/runMachine';
import { useGame } from '@/store/game';
import type { DepthsGame } from './useDepthsGame';

type DecisionPhase = Extract<Phase, { kind: 'resolved' | 'cleared' }>;

/**
 * CASH OUT vs GO DEEPER (versi kasar; DecisionModal dengan hold-to-confirm di Phase 5).
 * Di AWAIT_SETTLE hasil sudah pasti dari previewResolve; tx berikutnya yang menyimpannya on-chain.
 */
export function DecisionPanel({ game, phase }: { game: DepthsGame; phase: DecisionPhase }) {
  const snapshot = useGame((s) => s.snapshot);
  const [busy, setBusy] = useState<null | 'deeper' | 'cash'>(null);
  if (!snapshot) return null;
  const run = snapshot.run;
  const pool = snapshot.pool[0];
  const bag = phase.kind === 'resolved' ? run.bag + phase.award - phase.resolution.bagLoss : run.bag;
  const hp = phase.kind === 'resolved' ? phase.resolution.hpAfter : run.hp;
  const next = run.floor < MAX_FLOOR ? monster(run.floor + 1) : null;

  async function go(kind: 'deeper' | 'cash') {
    if (!game.machine) return;
    setBusy(kind);
    try {
      if (kind === 'deeper') await game.machine.descend();
      else await game.machine.cashOut();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {phase.kind === 'resolved' && <p className="text-lg">{outcomeLine(phase.resolution, phase.award)}</p>}
      <p className="text-xl font-bold tracking-wide">FLOOR {run.floor} CLEARED</p>
      <p>
        BAG {mon(bag)} MON · HP {hp}/{run.maxHp}
      </p>
      {next ? (
        <p className="text-sm opacity-80">
          Lantai berikutnya: monster ≈ HP {next.hp}, ATK {next.atk}, loot sampai {mon(cappedAward(next.loot, pool))} MON.
        </p>
      ) : (
        <p className="text-sm opacity-80">Ini lantai terdalam. Saatnya keluar.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded bg-emerald-700 px-4 py-2 font-bold disabled:opacity-40"
          disabled={busy !== null}
          onClick={() => go('cash')}
        >
          {busy === 'cash' ? 'Memanjat keluar…' : `CASH OUT ${mon(bag)}`}
        </button>
        {next && (
          <button
            className="rounded bg-red-800 px-4 py-2 font-bold disabled:opacity-40"
            disabled={busy !== null}
            onClick={() => go('deeper')}
          >
            {busy === 'deeper' ? 'Menuruni tangga…' : 'GO DEEPER'}
          </button>
        )}
      </div>
    </div>
  );
}
