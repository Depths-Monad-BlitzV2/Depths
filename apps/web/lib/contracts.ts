import { getAddress, isAddress, type Address, type ContractFunctionReturnType } from 'viem';
import { depthsAbi } from '../abi/Depths';

export { depthsAbi };

function readAddress(value: string | undefined): Address {
  if (!value || !isAddress(value)) {
    throw new Error('NEXT_PUBLIC_DEPTHS_ADDRESS belum di-set atau tidak valid (lihat apps/web/.env.example)');
  }
  return getAddress(value);
}

/** Address Depths dari env. Dibaca lazy supaya modul tetap bisa di-import di test tanpa env. */
export function depthsAddress(): Address {
  return readAddress(process.env.NEXT_PUBLIC_DEPTHS_ADDRESS);
}

/** Blok deploy, awal scan event. */
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK || 0);

/** Struct Run seperti dikembalikan `getRun` (typed dari ABI `as const`). */
export type OnchainRun = ContractFunctionReturnType<typeof depthsAbi, 'view', 'getRun'>;
export type ResolvePreview = ContractFunctionReturnType<typeof depthsAbi, 'view', 'previewResolve'>;
export type EncounterPreview = ContractFunctionReturnType<typeof depthsAbi, 'view', 'previewEncounter'>;
export type PoolInfo = ContractFunctionReturnType<typeof depthsAbi, 'view', 'poolInfo'>;

/** Konstanta contract yang dipakai frontend (CONTRACT_SPEC §3). */
export const MAX_AWARD_BPS = 500n;
export const BLOCKHASH_WINDOW = 256n;
export const MAX_GAS_TOPUP = 5n * 10n ** 17n;
