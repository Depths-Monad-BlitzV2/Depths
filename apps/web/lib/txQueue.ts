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

function message(err: unknown): string {
  const e = err as { shortMessage?: string; details?: string; message?: string };
  return e.shortMessage ?? e.details ?? e.message ?? String(err);
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

  private async sign(req: TxRequest, gas: bigint, nonce: number): Promise<Hex> {
    const fees = await this.getFees();
    return this.opts.account.signTransaction({
      type: 'eip1559',
      chainId: this.opts.client.chain.id,
      to: this.opts.address,
      data: req.data,
      gas,
      nonce,
      ...fees,
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
        if (!message(err).toLowerCase().includes('nonce')) throw err;
        // nonce lokal basi (tx dari tab lain / recovery): sinkron ulang dan tanda tangani ulang sekali
        this.nonce = null;
        nonce = await this.getNonce();
        raw = await this.sign(req, gas, nonce);
        await this.broadcast(raw);
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
