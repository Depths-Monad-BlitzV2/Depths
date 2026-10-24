import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, gasLimit, RunState } from './decide';

const T = 1_000n;

test('hanya AWAIT_REVEAL / AWAIT_SETTLE yang disentuh', () => {
  for (const state of [RunState.NONE, RunState.AWAIT_ACTION, RunState.FLOOR_CLEARED]) {
    assert.equal(decide({ state, floor: 1, targetBlock: T }, T + 10_000n), null);
  }
});

test('relay setelah 200 blok, sebelum itu diam', () => {
  const reveal = { state: RunState.AWAIT_REVEAL, floor: 3, targetBlock: T };
  const settle = { state: RunState.AWAIT_SETTLE, floor: 3, targetBlock: T };
  assert.equal(decide(reveal, T + 199n), null);
  assert.equal(decide(reveal, T + 200n), 'reveal');
  assert.equal(decide(settle, T + 200n), 'settle');
  assert.equal(decide(settle, T + 256n), 'settle', 'batas window masih valid');
});

test('lewat window → reap', () => {
  assert.equal(decide({ state: RunState.AWAIT_REVEAL, floor: 1, targetBlock: T }, T + 257n), 'reap');
  assert.equal(decide({ state: RunState.AWAIT_SETTLE, floor: 9, targetBlock: T }, T + 999n), 'reap');
});

test('relayAfter bisa diatur', () => {
  assert.equal(decide({ state: RunState.AWAIT_REVEAL, floor: 1, targetBlock: T }, T + 5n, 5n), 'reveal');
});

test('gas limit: estimate + 30%, dibatasi worst case, fallback worst case', () => {
  assert.equal(gasLimit('settle', 3, 100_000n), 130_000n);
  assert.equal(gasLimit('settle', 3, 400_000n), 250_000n);
  assert.equal(gasLimit('settle', 20, 300_000n), 390_000n);
  assert.equal(gasLimit('settle', 20, null), 450_000n);
  assert.equal(gasLimit('reap', 1, null), 250_000n);
});
