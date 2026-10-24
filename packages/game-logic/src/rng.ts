import { encodeAbiParameters, hexToBigInt, keccak256, type Hex } from 'viem';

/**
 * Sumber angka acak untuk satu resolusi: draw ke-`i`, dimodulo `mod`.
 * Logic gameplay hanya memakai `rand(seed, i) % mod`, jadi interface ini cukup untuk
 * on-chain parity (keccak) maupun simulasi cepat (PRNG biasa).
 */
export type Draw = (i: number, mod: number) => number;

const RAND_PARAMS = [{ type: 'bytes32' }, { type: 'uint256' }] as const;

/** `uint256(keccak256(abi.encode(seed, i)))`, sama persis dengan DepthsLogic.rand. */
export function rand(seed: Hex, i: number | bigint): bigint {
  return hexToBigInt(keccak256(encodeAbiParameters(RAND_PARAMS, [seed, BigInt(i)])));
}

/** Draw on-chain dari seed. Dipakai untuk replay dan verify. */
export function seedDraw(seed: Hex): Draw {
  return (i, mod) => Number(rand(seed, i) % BigInt(mod));
}

/** PRNG mulberry32 untuk simulasi dan estimasi (bukan untuk hasil on-chain). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw dari PRNG float [0, 1). Index diabaikan karena setiap panggilan sudah draw baru. */
export function randomDraw(rng: () => number = Math.random): Draw {
  return (_i, mod) => Math.floor(rng() * mod);
}
