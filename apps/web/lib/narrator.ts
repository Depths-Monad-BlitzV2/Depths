import { RunState } from 'game-logic';
import { combatLines, encounterLine, monsterName, outcomeLine, cashOutLine, deathLine } from './log';
import type { Phase, Snapshot } from './runMachine';

// Mengubah urutan snapshot menjadi baris log dan ringkasan akhir run. Pure terhadap input;
// setiap event hanya dinarasikan sekali walau snapshot yang sama datang berkali-kali.

export type Tone = 'info' | 'good' | 'bad';

export interface RunEnd {
  kind: 'cashOut' | 'death' | 'expired';
  floor: number;
  amount: bigint;
}

export interface NarratorSink {
  log(text: string, tone?: Tone): void;
  ended(end: RunEnd): void;
}

export class Narrator {
  private prev: { s: Snapshot; p: Phase } | null = null;
  private seen = new Set<string>();

  /**
   * @param narrateResolution false di UI: baris combat/hasil ditulis oleh timeline scene (UI_UX §2.1),
   *        supaya log tidak mendahului animasi.
   */
  constructor(
    private readonly sink: NarratorSink,
    private readonly opts: { narrateResolution?: boolean } = {},
  ) {}

  push(s: Snapshot, p: Phase): void {
    const r = s.run;
    const key = `${r.runId}:${r.floor}`;
    if (p.kind === 'encounter' && this.once(`${key}:enc`)) {
      this.sink.log(`Lantai ${r.floor}. ${encounterLine(p.encounter, p.monsterId)}`);
    }
    const narrate = this.opts.narrateResolution ?? true;
    if (narrate && (p.kind === 'resolved' || p.kind === 'dying') && this.once(`${key}:${r.targetBlock}:res`)) {
      if (p.replay) for (const line of combatLines(p.replay.events, monsterName(r.monsterId))) this.sink.log(line);
      const award = p.kind === 'resolved' ? p.award : 0n;
      this.sink.log(outcomeLine(p.resolution, award), p.resolution.survived ? 'good' : 'bad');
    }
    const prev = this.prev;
    if (prev && prev.s.run.state !== RunState.NONE && r.state === RunState.NONE) this.endOf(prev.s, prev.p);
    this.prev = { s, p };
  }

  private once(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  /** Run baru saja tertutup: tentukan penyebab dari fase terakhir yang terlihat. */
  private endOf(s: Snapshot, p: Phase): void {
    const floor = s.run.floor;
    if (p.kind === 'dying') {
      this.sink.log(deathLine(floor, s.run.bag), 'bad');
      return this.sink.ended({ kind: 'death', floor, amount: s.run.bag });
    }
    if (p.kind === 'expired' || p.kind === 'waitReveal' || p.kind === 'waitResolve' || p.kind === 'encounter') {
      // tertutup tanpa resolusi yang terlihat → reapExpired / expired saat disentuh
      this.sink.log(`Tersesat dalam gelap (timeout) di Lantai ${floor}.`, 'bad');
      return this.sink.ended({ kind: 'expired', floor, amount: s.run.bag });
    }
    const amount = p.kind === 'resolved' ? s.run.bag + p.award - p.resolution.bagLoss : s.run.bag;
    this.sink.log(cashOutLine(amount), 'good');
    this.sink.ended({ kind: 'cashOut', floor, amount });
  }
}
