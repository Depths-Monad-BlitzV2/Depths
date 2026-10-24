// Jalankan semua bagian Depths dari satu perintah. Lintas OS (Windows/macOS/Linux), tanpa dependency.
//
//   pnpm dev          testnet: web (localhost:3000) + keeper (kalau apps/keeper/.env ada)
//   pnpm dev:local    lokal  : anvil --block-time 1 → forge build → deploy (seed 80 MON) → abi:sync → web + keeper
//   pnpm check        semua test: forge, game-logic, web (test/lint/typecheck), keeper
//
// Mode lokal tidak menyentuh apps/web/.env.local atau apps/keeper/.env: alamat dan RPC anvil dikirim lewat
// environment proses, yang didahulukan oleh Next dan `node --env-file` di atas isi file .env.
// Ctrl+C mematikan semua proses anak.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const mode = process.argv[2] ?? 'testnet';

// Key default anvil (publik, hanya untuk chain lokal 31337). #0 deployer/owner, #1 keeper.
const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
];
const ANVIL_RPC = 'http://127.0.0.1:8545';
const SEED_POOL = '80000000000000000000';

const COLORS = { web: 36, keeper: 35, anvil: 33, forge: 32, check: 34 };
const children = new Set();

function label(name) {
  return `\x1b[${COLORS[name] ?? 37}m[${name}]\x1b[0m`;
}

function log(name, msg) {
  console.log(`${label(name)} ${msg}`);
}

/** Binary Foundry: dari PATH, atau ~/.foundry/bin kalau foundryup belum menambahkannya ke PATH. */
function foundry(bin) {
  const local = join(homedir(), '.foundry', 'bin', isWin ? `${bin}.exe` : bin);
  if (spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0) return bin;
  if (existsSync(local)) return local;
  console.error(`${bin} tidak ditemukan. Install Foundry: https://getfoundry.sh`);
  process.exit(1);
}

/** Proses jangka panjang dengan output berlabel. */
function start(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, FORCE_COLOR: '1', ...opts.env },
    shell: opts.shell ?? false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) log(name, line);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    children.delete(child);
    log(name, `berhenti (exit ${code ?? 'signal'})`);
    if (opts.critical) shutdown(code ?? 1);
  });
  return child;
}

/** Perintah sekali jalan; output langsung ke terminal. Mengembalikan true kalau sukses. */
function run(name, cmd, args, opts = {}) {
  log(name, `$ ${[cmd, ...args].join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    shell: opts.shell ?? false,
    stdio: 'inherit',
  });
  return res.status === 0;
}

// pnpm di Windows adalah pnpm.cmd, jadi butuh shell; argumen digabung jadi satu string (DEP0190)
const pnpm = (args, opts = {}) => (isWin ? [`pnpm ${args.join(' ')}`, [], { shell: true, ...opts }] : ['pnpm', args, opts]);

function kill(child) {
  if (child.exitCode !== null || !child.pid) return;
  // di Windows proses lewat shell punya cucu (next, tsx): matikan satu pohon
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) kill(c);
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForRpc(url, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return;
    } catch {
      // belum siap
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`RPC ${url} tidak merespons dalam ${timeoutMs / 1000} detik`);
}

// ---------------------------------------------------------------- mode

function startWeb(env) {
  start('web', ...pnpm(['-F', 'web', 'dev'], { env, critical: true }));
}

function testnet() {
  if (!existsSync(join(root, 'apps/web/.env.local'))) {
    console.error('apps/web/.env.local belum ada. Salin dari apps/web/.env.example (address testnet sudah terisi).');
    process.exit(1);
  }
  startWeb();
  if (existsSync(join(root, 'apps/keeper/.env'))) {
    start('keeper', ...pnpm(['-F', 'keeper', 'start']));
  } else {
    log('keeper', 'dilewati: apps/keeper/.env belum ada (salin dari .env.example kalau perlu relay)');
  }
}

async function local() {
  const anvil = foundry('anvil');
  const forge = foundry('forge');
  const contracts = join(root, 'contracts');

  // anvil wajib --block-time: automine tidak menghasilkan blok untuk reveal (CLAUDE.md)
  start('anvil', anvil, ['--block-time', '1', '--silent'], { critical: true });
  await waitForRpc(ANVIL_RPC);
  log('anvil', `siap di ${ANVIL_RPC}`);

  if (!run('forge', forge, ['build'], { cwd: contracts })) shutdown(1);
  const deployed = run('forge', forge, ['script', 'script/Deploy.s.sol', '--rpc-url', 'anvil', '--broadcast'], {
    cwd: contracts,
    env: { PRIVATE_KEY: ANVIL_KEYS[0], SEED_POOL },
  });
  if (!deployed) shutdown(1);
  if (!run('forge', ...pnpm(['abi:sync']))) shutdown(1);

  const dep = JSON.parse(readFileSync(join(contracts, 'deployments/31337.json'), 'utf8'));
  log('forge', `Depths di ${dep.depths} (blok ${dep.deployBlock}), pool awal 80 MON`);

  startWeb({
    NEXT_PUBLIC_CHAIN: 'anvil',
    NEXT_PUBLIC_DEPTHS_ADDRESS: dep.depths,
    NEXT_PUBLIC_DEPLOY_BLOCK: String(dep.deployBlock),
    NEXT_PUBLIC_RPC_HTTP: ANVIL_RPC,
    NEXT_PUBLIC_RPC_HTTP_FALLBACK: '',
    NEXT_PUBLIC_RPC_WS: '',
  });
  start(
    'keeper',
    ...pnpm(['-F', 'keeper', 'start'], {
      env: {
        CHAIN: 'anvil',
        KEEPER_PRIVATE_KEY: ANVIL_KEYS[1],
        DEPTHS_ADDRESS: dep.depths,
        DEPLOY_BLOCK: String(dep.deployBlock),
        RPC_HTTP: ANVIL_RPC,
      },
    }),
  );
  log('web', 'buka http://localhost:3000, import key anvil #0 ke wallet dan tambahkan network 127.0.0.1:8545 (chainId 31337)');
}

function check() {
  const forge = foundry('forge');
  const steps = [
    ['forge test', () => run('check', forge, ['test'], { cwd: join(root, 'contracts') })],
    ['game-logic test', () => run('check', ...pnpm(['-F', 'game-logic', 'test']))],
    ['web test', () => run('check', ...pnpm(['-F', 'web', 'test']))],
    ['web lint', () => run('check', ...pnpm(['-F', 'web', 'lint']))],
    ['web typecheck', () => run('check', ...pnpm(['-F', 'web', 'typecheck']))],
    ['keeper test', () => run('check', ...pnpm(['-F', 'keeper', 'test']))],
    ['keeper typecheck', () => run('check', ...pnpm(['-F', 'keeper', 'typecheck']))],
  ];
  const results = steps.map(([name, fn]) => [name, fn()]);
  console.log('');
  for (const [name, ok] of results) log('check', `${ok ? '\x1b[32m✓' : '\x1b[31m✗'}\x1b[0m ${name}`);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

if (mode === 'testnet') testnet();
else if (mode === 'local') await local().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  shutdown(1);
});
else if (mode === 'check') check();
else {
  console.error(`mode tidak dikenal: ${mode} (pakai testnet | local | check)`);
  process.exit(1);
}
