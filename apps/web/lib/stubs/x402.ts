// Stub untuk import opsional @x402/* di @coinbase/cdp-sdk (wagmi → @wagmi/connectors → @base-org/account).
// Depths tidak memakai pembayaran x402; alias di next.config.ts mencegah build gagal karena paket itu
// tidak terpasang. Nama di bawah = yang diimpor cdp-sdk dari modul yang di-alias. Kalau sampai
// terpanggil, error-nya eksplisit.

function unavailable(name: string): never {
  throw new Error(`@x402 tidak tersedia di Depths (${name})`);
}

export const x402Client = () => unavailable('x402Client');
export const registerExactEvmScheme = () => unavailable('registerExactEvmScheme');
export const ExactEvmScheme = () => unavailable('ExactEvmScheme');
export const UptoEvmScheme = () => unavailable('UptoEvmScheme');
export const ExactSvmScheme = () => unavailable('ExactSvmScheme');
export const registerExactSvmScheme = () => unavailable('registerExactSvmScheme');
export const toClientEvmSigner = () => unavailable('toClientEvmSigner');
