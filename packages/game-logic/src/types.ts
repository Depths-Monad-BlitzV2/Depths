// Mirror enum DepthsTypes.sol. Nilai numerik harus sama dengan Solidity.

export const RunState = {
  NONE: 0,
  AWAIT_REVEAL: 1,
  AWAIT_ACTION: 2,
  AWAIT_SETTLE: 3,
  FLOOR_CLEARED: 4,
} as const;
export type RunState = (typeof RunState)[keyof typeof RunState];

export const Encounter = {
  NONE: 0,
  MONSTER: 1,
  TREASURE: 2,
  TRAP: 3,
  MERCHANT: 4,
} as const;
export type Encounter = (typeof Encounter)[keyof typeof Encounter];

export const Action = {
  NONE: 0,
  FIGHT: 1,
  FLEE: 2,
  OPEN: 3,
  LEAVE: 4,
  PROCEED: 5,
  DISARM: 6,
  BUY: 7,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

/** = `outcomeCode` di event FloorResolved. */
export const Outcome = {
  NONE: 0,
  WIN: 1,
  FLED: 2,
  FLEE_FAIL_WIN: 3,
  TREASURE: 4,
  MIMIC_WIN: 5,
  TRAP_HP: 6,
  TRAP_LOOT: 7,
  DISARM_OK: 8,
  DISARM_FAIL: 9,
  LEAVE: 10,
  BUY: 11,
  KILLED: 12,
  FLEE_FAIL_KILLED: 13,
  MIMIC_KILLED: 14,
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export const DeathCause = {
  NONE: 0,
  KILLED: 1,
  EXPIRED: 2,
  TRAP: 3,
} as const;
export type DeathCause = (typeof DeathCause)[keyof typeof DeathCause];

/** Mirror struct Resolution. Uang dalam wei. */
export interface Resolution {
  outcome: Outcome;
  survived: boolean;
  hpAfter: number;
  /** Loot sebelum cap MAX_AWARD_BPS. */
  lootTable: bigint;
  /** Bag yang pindah ke pool. */
  bagLoss: bigint;
}
