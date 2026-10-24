import { createPublicClient, type Chain, type PublicClient, type Transport } from 'viem';
import { activeChain, POLLING_MS, transportFor } from './chains';

/** Public client untuk session wallet / run machine. Multicall batch kalau chain punya multicall3. */
export function createDepthsClient(chain: Chain = activeChain, transport?: Transport): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain,
    transport: transport ?? transportFor(chain),
    pollingInterval: POLLING_MS,
    batch: chain.contracts?.multicall3 ? { multicall: true } : undefined,
  });
}
