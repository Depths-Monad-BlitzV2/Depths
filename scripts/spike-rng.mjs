// Spike Phase 0 (BUILD_PLAN, ARCHITECTURE §4.4): ukur perilaku blockhash, block gap, latency, dan gas di Monad.
//
//   SPIKE_PRIVATE_KEY=0x... PROBE_ADDRESS=0x... [RPC_HTTP=...] [ITER=20] pnpm spike:rng
//
// Output: ringkasan markdown untuk docs/SPIKE_RESULTS.md. Bisa juga dijalankan ke anvil --block-time 1.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, decodeEventLog, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { abi } = JSON.parse(readFileSync(join(root, 'contracts/out/RngProbe.sol/RngProbe.json'), 'utf8'));

const RPC = process.env.RPC_HTTP ?? 'https://testnet-rpc.monad.xyz';
const ITER = Number(process.env.ITER ?? 20);
const PROBE = process.env.PROBE_ADDRESS;
const KEY = process.env.SPIKE_PRIVATE_KEY;
if (!PROBE || !KEY) {
  console.error('Set SPIKE_PRIVATE_KEY dan PROBE_ADDRESS (deploy dulu: forge script script/RngProbe.s.sol)');
  process.exit(1);
}

const GAS_COMMIT = 60_000n;
const GAS_REVEAL = 80_000n;
const ZERO = `0x${'0'.repeat(64)}`;
const EIP2935 = '0x0000F90827F1C53a10cb7A02335B175320002935';

const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ transport: http(RPC), pollingInterval: 200 });
const chainId = await pub.getChainId();
const chain = { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const send = (functionName, nonce, gas) =>
  wallet.writeContract({ address: PROBE, abi, functionName, nonce, gas });

async function timedReceipt(hashPromise) {
  const t0 = performance.now();
  const hash = await hashPromise;
  const receipt = await pub.waitForTransactionReceipt({ hash, pollingInterval: 200 });
  return { receipt, ms: performance.now() - t0 };
}

function revealedLog(receipt) {
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (ev.eventName === 'Revealed') return ev.args;
    } catch {
      // log lain
    }
  }
  return undefined;
}

async function waitBlockAbove(n) {
  for (;;) {
    if ((await pub.getBlockNumber({ cacheTime: 0 })) > n) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};

const balanceStart = await pub.getBalance({ address: account.address });
let nonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' });
const rows = [];
const latencies = [];
const receipts = [];

for (let k = 0; k < ITER; k++) {
  // commit dan reveal dikirim back-to-back tanpa menunggu: apakah bisa masuk blok yang sama?
  const commitP = timedReceipt(send('commit', nonce++, GAS_COMMIT));
  const revealFastP = timedReceipt(send('reveal', nonce++, GAS_REVEAL));
  const [c, rf] = await Promise.all([commitP, revealFastP]);
  latencies.push(c.ms);
  const target = c.receipt.blockNumber + 1n;
  let reveal = rf;
  let retried = false;
  if (rf.receipt.status !== 'success') {
    await waitBlockAbove(target);
    reveal = await timedReceipt(send('reveal', nonce++, GAS_REVEAL));
    retried = true;
  }
  latencies.push(reveal.ms);
  const ev = reveal.receipt.status === 'success' ? revealedLog(reveal.receipt) : undefined;
  receipts.push(c.receipt, rf.receipt);
  if (retried) receipts.push(reveal.receipt);
  rows.push({
    k,
    commitBlock: c.receipt.blockNumber,
    fastRevealBlock: rf.receipt.blockNumber,
    fastRevealOk: rf.receipt.status === 'success',
    revealBlock: reveal.receipt.blockNumber,
    retried,
    targetHashZero: ev ? ev.targetHash === ZERO : null,
    // contract mengembalikan 0 kalau chain belum sepanjang itu → n/a
    h256Zero: ev && reveal.receipt.blockNumber >= 256n ? ev.hash256Ago === ZERO : null,
    h300Zero: ev && reveal.receipt.blockNumber >= 300n ? ev.hash300Ago === ZERO : null,
    prevrandao: ev?.prevrandao,
  });
  console.error(`iter ${k + 1}/${ITER}: commit #${c.receipt.blockNumber}, reveal #${reveal.receipt.blockNumber}${retried ? ' (retry)' : ''}`);
}

// Peta window blockhash lewat eth_call
const head = await pub.getBlockNumber({ cacheTime: 0 });
const window = [];
for (const back of [1n, 128n, 255n, 256n, 257n, 300n, 1000n, 8191n]) {
  if (back > head) continue;
  const [h] = await pub.readContract({ address: PROBE, abi, functionName: 'peek', args: [head - back] });
  window.push({ back, zero: h === ZERO });
}
const eip2935Code = await pub.getCode({ address: EIP2935 });

const balanceEnd = await pub.getBalance({ address: account.address });
const spent = balanceStart - balanceEnd;
const limitTotal = rows.reduce((s, r) => s + GAS_COMMIT + GAS_REVEAL + (r.retried ? GAS_REVEAL : 0n), 0n);
const usedTotal = receipts.reduce((s, r) => s + r.gasUsed, 0n);
const feeTotal = receipts.reduce((s, r) => s + r.gasUsed * r.effectiveGasPrice, 0n);

const fmt = (b) => (b === null ? 'n/a' : b ? '**0**' : 'ok');
console.log(`## Hasil spike RNG (${new Date().toISOString()})\n`);
console.log(`- RPC: ${RPC} (chainId ${chainId}), ${ITER} iterasi, ${receipts.length} tx (${receipts.filter((r) => r.status !== 'success').length} revert)`);
console.log(`- Latency submit→receipt: p50 ${pct(latencies, 50).toFixed(0)} ms, p95 ${pct(latencies, 95).toFixed(0)} ms`);
console.log(`- Reveal back-to-back (tanpa tunggu) sukses: ${rows.filter((r) => r.fastRevealOk).length}/${ITER}`);
console.log(`- Commit & reveal back-to-back di blok yang sama: ${rows.filter((r) => r.fastRevealBlock === r.commitBlock).length}/${ITER}`);
console.log(`- blockhash(target) = 0: ${rows.filter((r) => r.targetHashZero).length}/${ITER}`);
const zeroOf = (key) => (rows.every((r) => r[key] === null) ? 'n/a (chain < 300 blok)' : `${rows.filter((r) => r[key]).length}/${ITER}`);
console.log(`- blockhash(n-256) = 0: ${zeroOf('h256Zero')}, blockhash(n-300) = 0: ${zeroOf('h300Zero')}`);
console.log(`- prevrandao unik: ${new Set(rows.map((r) => String(r.prevrandao))).size}/${ITER}`);
console.log(`- EIP-2935 history contract: ${eip2935Code && eip2935Code !== '0x' ? 'ADA' : 'tidak ada'}`);
console.log(`- Window blockhash via eth_call (head ${head}): ${window.map((w) => `-${w.back}:${w.zero ? '0' : 'ok'}`).join(', ')}`);
console.log(`- Gas: Σ gasUsed receipt ${usedTotal}, Σ gas limit ${limitTotal}`);
console.log(`- Biaya: saldo terpakai ${formatEther(spent)} MON vs Σ gasUsed×price ${formatEther(feeTotal)} MON (kalau saldo ≈ limit×price, Monad menagih gas limit)`);
console.log('\n| # | commit blk | reveal cepat | reveal blk | retry | hash(target) | hash(-256) | hash(-300) |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.k} | ${r.commitBlock} | ${r.fastRevealOk ? `ok #${r.fastRevealBlock}` : `revert #${r.fastRevealBlock}`} | ${r.revealBlock} | ${r.retried ? 'ya' : '-'} | ${fmt(r.targetHashZero)} | ${fmt(r.h256Zero)} | ${fmt(r.h300Zero)} |`,
  );
}
