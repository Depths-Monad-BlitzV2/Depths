// Web Worker: estimasi win chance Monte Carlo 500× (GAME_DESIGN §4.3, label "estimasi").
import { estimateWinChance, mulberry32, type CombatInput } from 'game-logic';

export interface WinChanceRequest {
  id: number;
  input: CombatInput;
  samples: number;
  seed: number;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WinChanceRequest>) => void) | null;
  postMessage(msg: { id: number; p: number }): void;
};

ctx.onmessage = (e) => {
  const { id, input, samples, seed } = e.data;
  ctx.postMessage({ id, p: estimateWinChance(input, samples, mulberry32(seed)) });
};
