import { keccak256, type Address, type Chain, type Hex, type PublicClient, type Transport } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

// Antrian tx serial untuk session wallet (ARCHITECTURE §6.1):
// - satu tx dalam penerbangan, nonce dikelola lokal (sinkron dari `pending` saat init/recovery)
// - gas limit eksplisit dari lib/gas.ts (Monad menagih gas limit)
// - tx ditandatangani sekali; retry jaringan mengirim ulang raw tx yang sama (hash sama → tidak ada tx ganda)
// - revert tidak di-retry, kecuali `retryGas` mendeteksi out-of-gas → kirim ulang sekali dengan limit lebih besar

export type TxStatus = 'queued' | 'pending' | 'success' | 'reverted' | 'failed';

export interface TxRecord {
  id: number;
  label: string;
  status: TxStatus;
  gas: bigint;
  hash?: Hex;
  nonce?: number;
  /** ms dari kirim sampai RPC menerima tx. */
  submitMs?: number;
  /** ms dari kirim sampai receipt (angka yang ditampilkan di TxTicker). */
  latencyMs?: number;
  block?: bigint;
  error?: string;
  /** Tx relay fallback (reveal/settle) yang dikirim otomatis. */
  relay?: boolean;
  /** Percobaan ulang setelah out-of-gas. */
  gasRetry?: boolean;
}

export interface TxRequest {
  label: string;
  /** Calldata ke Depths, di-encode dengan `encodeFunctionData({ abi: depthsAbi, ... })` (typed dari ABI). */
  data: Hex;
  gas: bigint;
  relay?: boolean;
  /**
   * Dipanggil kalau tx revert. Return gas limit baru kalau revert disebabkan out-of-gas
   * (mis. `eth_estimateGas` sekarang lolos dengan nilai > limit lama), atau null kalau revert sungguhan.
   */
  retryGas?: (usedLimit: bigint) => Promise<bigint | null>;
}

export interface TxQueueOptions {
  client: PublicClient<Transport, Chain>;
  account: PrivateKeyAccount;
  address: Address;
  onUpdate?: (rec: TxRecord) => void;
  /** Default 3 percobaan jaringan dengan backoff 300ms × n (ARCHITECTURE §6.1). */
  networkRetries?: number;
  backoffMs?: number;
  receiptTimeoutMs?: number;
}

const FEE_TTL_MS = 30_000;
/** Monad reserve balance: konsensus melihat saldo k = 3 blok lalu; tunggu k + 1 sebelum kirim ulang. */
const LAGGED_BALANCE_BLOCKS = 4n;

function isInsufficientBalance(msg: string): boolean {
  return /insufficient (balance|funds)|signer had insufficient/.test(msg);
}

/** Alasan asli dari RPC (`details`) lebih informatif daripada `shortMessage` viem yang generik. */
function message(err: unknown): string {
  const e = err as { shortMessage?: string; details?: string; message?: string };
  return e.details ?? e.shortMessage ?? e.message ?? String(err);
}

/**
 * Pesan error tx untuk pemain (UI_UX §6: toast singkat). Pesan tak dikenal dikembalikan apa adanya.
 * @param from `session` = tx in-run dari burner, `wallet` = enterDungeon / top-up dari wallet utama
 */
export function describeTxError(raw: string | undefined, from: 'session' | 'wallet' = 'session'): string {
  const m = (raw ?? '').toLowerCase();
  if (/insufficient (balance|funds)|signer had insufficient/.test(m)) {
    return from === 'session'
      ? 'Saldo session wallet tidak cukup untuk gas. Klik Top-up, lalu ulangi langkahmu.'
      : 'Saldo wallet utama tidak cukup (atau baru saja diisi dan belum terlihat). Tunggu beberapa detik lalu coba lagi.';
  }
  if (m.includes('nonce')) return 'Urutan transaksi bentrok (tab lain?). Status dibaca ulang dari chain, silakan ulangi.';
  if (m.includes('timeout') || m.includes('fetch failed') || m.includes('network')) {
    return 'Koneksi ke RPC terputus. Status dibaca ulang dari chain, silakan ulangi.';
  }
  return raw || 'Transaksi gagal.';
}

function isNetworkError(err: unknown): boolean {
  const name = (err as { name?: string }).name ?? '';
  const msg = message(err).toLowerCase();
  return (
    name === 'HttpRequestError' ||
    name === 'TimeoutError' ||
    name === 'WebSocketRequestError' ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnreset')
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TxQueue {
  private readonly opts: Required<Omit<TxQueueOptions, 'onUpdate'>> & Pick<TxQueueOptions, 'onUpdate'>;
  private tail: Promise<unknown> = Promise.resolve();
  private nonce: number | null = null;
  private nextId = 1;
  private fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; at: number } | null = null;

  constructor(opts: TxQueueOptions) {
    this.opts = { networkRetries: 3, backoffMs: 300, receiptTimeoutMs: 60_000, ...opts };
  }

  get sender(): Address {
    return this.opts.account.address;
  }

  /** Paksa sinkron nonce dari chain pada tx berikutnya (recovery / setelah error nonce). */
  resetNonce(): void {
    this.nonce = null;
  }

  /** Masukkan tx ke antrian. Resolve setelah tx final (success / reverted / failed), tidak pernah reject. */
  enqueue(req: TxRequest): Promise<TxRecord> {
    const rec: TxRecord = { id: this.nextId++, label: req.label, status: 'queued', gas: req.gas, relay: req.relay };
    this.emit(rec);
    const run = this.tail.then(() => this.process(req, rec));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private emit(rec: TxRecord): void {
    this.opts.onUpdate?.({ ...rec });
  }

  private async getNonce(): Promise<number> {
    if (this.nonce === null) {
      this.nonce = await this.opts.client.getTransactionCount({ address: this.sender, blockTag: 'pending' });
    }
    return this.nonce;
  }

  private async getFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    if (!this.fees || Date.now() - this.fees.at > FEE_TTL_MS) {
      const f = await this.opts.client.estimateFeesPerGas();
      this.fees = { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas, at: Date.now() };
    }
    return this.fees;
  }

  /** `bump` (wei) menaikkan priority fee supaya hash berubah: RPC Monad mengingat penolakan per hash. */
  private async sign(req: TxRequest, gas: bigint, nonce: number, bump = 0n): Promise<Hex> {
    const fees = await this.getFees();
    return this.opts.account.signTransaction({
      type: 'eip1559',
      chainId: this.opts.client.chain.id,
      to: this.opts.address,
      data: req.data,
      gas,
      nonce,
      maxFeePerGas: fees.maxFeePerGas + bump,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas + bump,
    });
  }

  /** Kirim raw tx, retry kalau error jaringan. "already known" berarti tx sudah diterima RPC. */
  private async broadcast(raw: Hex): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        await this.opts.client.sendRawTransaction({ serializedTransaction: raw });
        return;
      } catch (err) {
        const msg = message(err).toLowerCase();
        if (msg.includes('already known') || msg.includes('already imported')) return;
        if (!isNetworkError(err) || attempt >= this.opts.networkRetries) throw err;
        attempt++;
        await sleep(this.opts.backoffMs * attempt);
      }
    }
  }

  /** Saldo terbaru di chain cukup untuk gas × maxFee → penolakan disebabkan saldo tertunda, bukan saldo habis. */
  private async fundedButLagging(gas: bigint): Promise<boolean> {
    const [balance, fees] = await Promise.all([
      this.opts.client.getBalance({ address: this.sender, blockTag: 'latest' }),
      this.getFees(),
    ]);
    return balance >= gas * fees.maxFeePerGas;
  }

  private async waitBlocks(n: bigint): Promise<void> {
    const start = await this.opts.client.getBlockNumber({ cacheTime: 0 });
    while ((await this.opts.client.getBlockNumber({ cacheTime: 0 })) < start + n) await sleep(200);
  }

  private async process(req: TxRequest, rec: TxRecord): Promise<TxRecord> {
    let gas = req.gas;
    for (let gasAttempt = 0; ; gasAttempt++) {
      const final = await this.sendOnce(req, rec, gas);
      if (final.status !== 'reverted' || !req.retryGas || gasAttempt > 0) return final;
      const bigger = await req.retryGas(gas).catch(() => null);
      if (bigger === null || bigger <= gas) return final;
      // out-of-gas: tx revert tetap memakai nonce, jadi kirim ulang dengan nonce berikutnya
      gas = bigger;
      rec = { id: this.nextId++, label: `${req.label} (retry gas)`, status: 'queued', gas, relay: req.relay, gasRetry: true };
      this.emit(rec);
    }
  }

  private async sendOnce(req: TxRequest, rec: TxRecord, gas: bigint): Promise<TxRecord> {
    const { client } = this.opts;
    try {
      let nonce = await this.getNonce();
      let raw = await this.sign(req, gas, nonce);
      const t0 = performance.now();
      try {
        await this.broadcast(raw);
      } catch (err) {
        const msg = message(err).toLowerCase();
        if (isInsufficientBalance(msg) && (await this.fundedButLagging(gas))) {
          // Monad: konsensus memakai saldo 3 blok lalu (reserve balance, k = 3). Dana yang baru masuk
          // (top-up / enterDungeon) belum terlihat. Tunggu beberapa blok lalu tanda tangani ulang dengan
          // hash baru, karena RPC menolak ulang raw tx yang sama walau saldo sudah terlihat.
          await this.waitBlocks(LAGGED_BALANCE_BLOCKS);
          raw = await this.sign(req, gas, nonce, 1n);
          await this.broadcast(raw);
        } else if (msg.includes('nonce')) {
          // nonce lokal basi (tx dari tab lain / recovery): sinkron ulang dan tanda tangani ulang sekali
          this.nonce = null;
          nonce = await this.getNonce();
          raw = await this.sign(req, gas, nonce);
          await this.broadcast(raw);
        } else {
          throw err;
        }
      }
      const hash = keccak256(raw);
      this.nonce = nonce + 1;
      Object.assign(rec, { status: 'pending', hash, nonce, gas, submitMs: Math.round(performance.now() - t0) });
      this.emit(rec);

      const receipt = await client.waitForTransactionReceipt({ hash, timeout: this.opts.receiptTimeoutMs });
      Object.assign(rec, {
        status: receipt.status === 'success' ? 'success' : 'reverted',
        latencyMs: Math.round(performance.now() - t0),
        block: receipt.blockNumber,
      });
      this.emit(rec);
      return rec;
    } catch (err) {
      this.nonce = null; // status nonce tidak pasti, sinkron ulang di tx berikutnya
      Object.assign(rec, { status: 'failed', error: message(err) });
      this.emit(rec);
      return rec;
    }
  }
}
