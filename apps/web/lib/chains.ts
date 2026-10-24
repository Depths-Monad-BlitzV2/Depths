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

/** Kode error JSON-RPC yang menandakan masalah di sisi RPC (layak dicoba ke RPC lain). */
const FALLBACK_RPC_CODES = new Set([
  -32601, // method not found / tidak tersedia di provider ini
  -32603, // internal error
  -32002, // resource unavailable
  -32005, // limit exceeded / rate limit
]);

/**
 * Jangan fallback untuk error semantik (saldo kurang, parameter invalid, revert): RPC lain akan memberi
 * jawaban yang sama atau menutupi alasan aslinya. Error jaringan (tanpa kode JSON-RPC) tetap fallback.
 */
export function rpcShouldThrow(err: Error): boolean {
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'number') return false;
  return !FALLBACK_RPC_CODES.has(code);
}

/** Transport HTTP dengan fallback otomatis ke RPC berikutnya kalau RPC utama tidak bisa dihubungi. */
export function transportFor(chain: Chain = activeChain): Transport {
  return fallback(
    rpcUrls(chain).map((url) => http(url, { retryCount: 1, timeout: 10_000 })),
    { rank: false, shouldThrow: rpcShouldThrow },
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
