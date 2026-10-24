// Keeper bot: relay reveal/settle yang macet + reapExpired (BUILD_PLAN Phase 3, ARCHITECTURE §4.2.1).
// Mengumpulkan owner dari event, lalu setiap tick membaca getRun dan mengirim tx kalau sudah ≥ 200 blok
// sejak targetBlock tanpa tx keputusan (tab ditutup), atau run sudah lewat window (reap).

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hex,
  isAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, monadTestnet } from 'viem/chains';
import { depthsAbi } from '../abi/Depths';
import { decide, gasLimit, DEFAULT_RELAY_AFTER, RunState, type KeeperAction } from './decide';

const REQUIRED = ['KEEPER_PRIVATE_KEY', 'DEPTHS_ADDRESS', 'RPC_HTTP'] as const;
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`keeper: env belum di-set: ${missing.join(', ')} (lihat apps/keeper/.env.example)`);
  process.exit(1);
}

const env = process.env as Record<(typeof REQUIRED)[number], string> & NodeJS.ProcessEnv;
if (!isAddress(env.DEPTHS_ADDRESS)) {
  console.error('keeper: DEPTHS_ADDRESS tidak valid');
  process.exit(1);
}
const depths: Address = env.DEPTHS_ADDRESS;
const chain: Chain = env.CHAIN === 'anvil' ? foundry : monadTestnet;
const pollMs = Number(env.POLL_MS ?? 2_000);
const logRange = BigInt(env.LOG_RANGE ?? 100); // RPC publik membatasi range eth_getLogs
const lookback = BigInt(env.LOOKBACK_BLOCKS ?? 2_000);
const relayAfter = BigInt(env.RELAY_AFTER_BLOCKS ?? DEFAULT_RELAY_AFTER);

const transport = http(env.RPC_HTTP);
const client = createPublicClient({ chain, transport, pollingInterval: 200 });
const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY as Hex);
const wallet = createWalletClient({ chain, transport, account });

/** Owner yang mungkin punya run aktif. Dihapus saat getRun menunjukkan NONE. */
const owners = new Set<Address>();
let scannedTo: bigint;

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function scanEvents(latest: bigint): Promise<void> {
  while (scannedTo < latest) {
    const fromBlock = scannedTo + 1n;
    const toBlock = fromBlock + logRange - 1n < latest ? fromBlock + logRange - 1n : latest;
    const logs = await client.getContractEvents({ address: depths, abi: depthsAbi, fromBlock, toBlock });
    for (const l of logs) {
      if (l.eventName === 'RunStarted' || l.eventName === 'FloorEntered' || l.eventName === 'ActionCommitted') {
        if (l.args.owner && !owners.has(l.args.owner)) {
          owners.add(l.args.owner);
          log(`watch ${l.args.owner} (${l.eventName} @${l.blockNumber})`);
        }
      }
    }
    scannedTo = toBlock;
  }
}

async function send(action: KeeperAction, owner: Address, floor: number): Promise<void> {
  const functionName = action === 'reap' ? 'reapExpired' : action;
  let estimate: bigint | null = null;
  try {
    estimate = await client.estimateContractGas({ address: depths, abi: depthsAbi, functionName, args: [owner], account });
  } catch (err) {
    // estimate gagal = kemungkinan besar tx sudah tidak valid (player/keeper lain mendahului). Cek ulang tick depan.
    log(`skip ${functionName}(${owner}): estimate gagal (${(err as Error).message.split('\n')[0]})`);
    return;
  }
  const gas = gasLimit(action, floor, estimate);
  const t0 = performance.now();
  const hash = await wallet.writeContract({ address: depths, abi: depthsAbi, functionName, args: [owner], gas });
  const receipt = await client.waitForTransactionReceipt({ hash });
  log(
    `${functionName}(${owner}) floor ${floor} status=${receipt.status} gas=${gas} estimate=${estimate} ` +
      `block=${receipt.blockNumber} ${Math.round(performance.now() - t0)}ms ${hash}`,
  );
}

async function tick(): Promise<void> {
  const latest = await client.getBlockNumber();
  await scanEvents(latest);
  for (const owner of [...owners]) {
    const run = await client.readContract({ address: depths, abi: depthsAbi, functionName: 'getRun', args: [owner] });
    if (run.state === RunState.NONE) {
      owners.delete(owner);
      continue;
    }
    const action = decide({ state: run.state, floor: run.floor, targetBlock: run.targetBlock }, latest, relayAfter);
    if (action) await send(action, owner, run.floor);
  }
}

async function main(): Promise<void> {
  const latest = await client.getBlockNumber();
  const deployBlock = env.DEPLOY_BLOCK ? BigInt(env.DEPLOY_BLOCK) : 0n;
  const start = latest > lookback ? latest - lookback : 0n;
  scannedTo = (deployBlock > start ? deployBlock : start) - 1n;
  const balance = await client.getBalance({ address: account.address });
  log(`keeper ${account.address} | chain ${chain.id} | Depths ${depths} | saldo ${balance} wei`);
  log(`scan dari blok ${scannedTo + 1n}, relay setelah ${relayAfter} blok, poll ${pollMs}ms`);

  for (;;) {
    try {
      await tick();
    } catch (err) {
      log(`tick error: ${(err as Error).message.split('\n')[0]}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

void main();
