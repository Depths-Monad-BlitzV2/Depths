// Gas limit eksplisit per jalur (CONTRACT_SPEC §8). Monad menagih gas LIMIT, bukan gas used, termasuk tx
// yang revert, jadi limit dihitung dari jalur yang sudah pasti (hasil terlihat lewat preview sebelum tx).
// Angka = gas tx penuh (21k intrinsic + calldata + eksekusi) di jadwal Monad, terkalibrasi di testnet Phase 3.

/** Biaya per draw combat (serangan) di resolusi, termasuk keccak + dmg. */
export const GAS_PER_ATTACK = 260n;
/** Margin di atas base; testnet: estimate × 1.2 selalu cukup. */
export const GAS_MARGIN_PCT = 20n;
/** Batas atas untuk retry sekali kalau tx out-of-gas (combat 64 round + insert board + auto cash out). */
export const WORST_CASE_GAS = 450_000n;

/** Base gas per jalur, tanpa margin. */
export const GAS_BASE = {
  /** `act` di AWAIT_REVEAL: `_reveal` + commit aksi. */
  actRevealCommit: 53_000n,
  /** `act` LEAVE di AWAIT_REVEAL (instan). */
  actRevealLeave: 54_000n,
  /** `act` BUY di AWAIT_REVEAL (instan), 1–3 jenis item. */
  actRevealBuy: 75_000n,
  /** `act` di AWAIT_ACTION (setelah reveal fallback). */
  actCommit: 48_000n,
  actLeave: 48_000n,
  actBuy: 70_000n,
  /** `descend` di AWAIT_SETTLE tanpa loot/bag loss (mis. FLED, TRAP_HP). */
  descendSettle: 54_000n,
  /** `descend` di FLOOR_CLEARED. */
  descendCleared: 45_000n,
  /** `reveal(owner)` fallback. */
  reveal: 40_000n,
  /** `settle(owner)` fallback tanpa loot. */
  settle: 43_000n,
} as const;

/** Tambahan kalau resolusi mengubah pool: award loot (LootAwarded + PoolChanged) atau bag loss trap. */
export const GAS_POOL_CHANGE = 16_500n;
/** Tambahan saat reveal pertama per owner: slot `encounterSeed` masih 0 (state growth 17k di Monad). */
export const GAS_FIRST_REVEAL = 19_000n;

export type GasPath = keyof typeof GAS_BASE;

export interface GasInput {
  path: GasPath;
  /** Jumlah serangan combat dari `replayCombat` (resolusi di jalur ini). */
  attacks?: number;
  /** Resolusi mengubah pool (lootTable > 0 atau bagLoss > 0). */
  poolChange?: boolean;
  /** Jalur reveal dan `run.encounterSeed` masih 0x0. */
  firstReveal?: boolean;
}

export function withMargin(gas: bigint): bigint {
  return (gas * (100n + GAS_MARGIN_PCT)) / 100n;
}

/** Gas limit untuk jalur yang biayanya pasti. Kematian dan cash out memakai `eth_estimateGas` (board). */
export function gasLimit(input: GasInput): bigint {
  let gas = GAS_BASE[input.path];
  if (input.attacks) gas += BigInt(input.attacks) * GAS_PER_ATTACK;
  if (input.poolChange) gas += GAS_POOL_CHANGE;
  if (input.firstReveal) gas += GAS_FIRST_REVEAL;
  const limit = withMargin(gas);
  return limit < WORST_CASE_GAS ? limit : WORST_CASE_GAS;
}

/** Limit dari hasil `eth_estimateGas` (cash out / kematian): estimate + margin, dibatasi worst case. */
export function gasFromEstimate(estimate: bigint): bigint {
  const limit = withMargin(estimate);
  return limit < WORST_CASE_GAS ? limit : WORST_CASE_GAS;
}
