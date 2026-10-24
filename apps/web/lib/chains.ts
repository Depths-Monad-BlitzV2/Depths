import { fallback, http, type Chain, type Transport } from 'viem';
import { foundry, monadTestnet } from 'viem/chains';

// Modul ini tidak bergantung pada React/Next, supaya bisa dipakai juga oleh scripts/e2e.ts di Node.
// NEXT_PUBLIC_* harus dibaca dengan nama statis supaya di-inline oleh Next.

export { monadTestnet };
/** Anvil lokal (`anvil --block-time 1`), chainId 31337. */
export const anvil = foundry;

export type ChainKey = 'monadTestnet' | 'anvil';

export function chainFor(key: string | undefined): Chain {
  return key === 'anvil' ? anvil : monadTestnet;
}

export const activeChain: Chain = chainFor(process.env.NEXT_PUBLIC_CHAIN);

/** RPC publik Monad testnet yang terverifikasi hidup (2026-10-23), dipakai sebagai cadangan. */
const MONAD_TESTNET_RPCS = [
  'https://testnet-rpc.monad.xyz',
  'https://rpc.ankr.com/monad_testnet',
  'https://monad-testnet.drpc.org',
];

/** Urutan RPC HTTP: env utama, env cadangan (dipisah koma), lalu default chain. Tanpa duplikat. */
export function rpcUrls(chain: Chain = activeChain): string[] {
  const fromEnv = [process.env.NEXT_PUBLIC_RPC_HTTP, ...(process.env.NEXT_PUBLIC_RPC_HTTP_FALLBACK ?? '').split(',')];
  const defaults = chain.id === monadTestnet.id ? MONAD_TESTNET_RPCS : chain.rpcUrls.default.http;
  const urls = [...fromEnv, ...defaults].map((u) => u?.trim()).filter((u): u is string => !!u);
  return [...new Set(urls)];
}

/** Transport HTTP dengan fallback otomatis ke RPC berikutnya kalau RPC utama error. */
export function transportFor(chain: Chain = activeChain): Transport {
  return fallback(
    rpcUrls(chain).map((url) => http(url, { retryCount: 1, timeout: 10_000 })),
    { rank: false },
  );
}

/** Interval polling receipt/blok (CLAUDE.md: 200ms untuk receipt). */
export const POLLING_MS = 200;

export function explorerTx(hash: string, chain: Chain = activeChain): string | null {
  const url = chain.blockExplorers?.default.url;
  return url ? `${url}/tx/${hash}` : null;
}

export function explorerAddress(address: string, chain: Chain = activeChain): string | null {
  const url = chain.blockExplorers?.default.url;
  return url ? `${url}/address/${address}` : null;
}
