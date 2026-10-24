import { isHex, type Address, type Chain, type Hex, type PublicClient, type Transport } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

// Session wallet (burner) per owner, ARCHITECTURE §6.2. Private key disimpan di localStorage dan dianggap
// bisa bocor (SECURITY §5): exposure dibatasi top-up MAX_GAS_TOPUP, dan bag tidak pernah dikirim ke burner.

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Default top-up session wallet (UI_UX §5): ±14 lantai di 102 gwei. */
export const DEFAULT_TOPUP = 25n * 10n ** 16n;
/** Ambang saldo rendah ≈ biaya 2 lantai (2 × 152k gas × 102 gwei ≈ 0.031 MON), dibulatkan. */
export const LOW_BALANCE = 5n * 10n ** 16n;

export function sessionStorageKey(owner: Address): string {
  return `depths.session.${owner.toLowerCase()}`;
}

/** Store in-memory untuk Node / test. */
export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

export interface Session {
  owner: Address;
  account: PrivateKeyAccount;
  /** true kalau burner baru dibuat di panggilan ini (tampilkan modal onboarding). */
  created: boolean;
}

/** Ambil burner milik `owner`, atau buat baru dan simpan. */
export function loadOrCreateSession(owner: Address, store: KeyValueStore): Session {
  const key = sessionStorageKey(owner);
  const saved = store.getItem(key);
  if (saved && isHex(saved) && saved.length === 66) {
    return { owner, account: privateKeyToAccount(saved), created: false };
  }
  const pk: Hex = generatePrivateKey();
  store.setItem(key, pk);
  return { owner, account: privateKeyToAccount(pk), created: true };
}

/** Hapus burner dari storage (mis. setelah withdraw dan player ingin key baru). */
export function forgetSession(owner: Address, store: KeyValueStore): void {
  store.removeItem(sessionStorageKey(owner));
}

export async function sessionBalance(client: PublicClient<Transport, Chain>, address: Address): Promise<bigint> {
  return client.getBalance({ address });
}

/**
 * Kirim seluruh saldo burner ke owner. Memakai tx legacy dengan gas limit 21000 dan gasPrice tetap,
 * karena Monad menagih limit × price; sisa saldo burner jadi 0.
 * @returns hash tx, atau null kalau saldo tidak cukup untuk gas
 */
export async function withdrawSession(
  client: PublicClient<Transport, Chain>,
  account: PrivateKeyAccount,
  to: Address,
): Promise<Hex | null> {
  const [balance, gasPrice, nonce] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.getGasPrice(),
    client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
  ]);
  const fee = 21_000n * gasPrice;
  if (balance <= fee) return null;
  const raw = await account.signTransaction({
    type: 'legacy',
    chainId: client.chain.id,
    to,
    value: balance - fee,
    gas: 21_000n,
    gasPrice,
    nonce,
  });
  const hash = await client.sendRawTransaction({ serializedTransaction: raw });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}
