import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig } from 'wagmi';
import { activeChain, POLLING_MS, transportFor } from './chains';

// Config wagmi + RainbowKit untuk main wallet (satu-satunya popup: enterDungeon).
// Tanpa NEXT_PUBLIC_WC_PROJECT_ID hanya wallet injected (MetaMask/Rabby extension) yang tersedia,
// karena WalletConnect butuh project id dari cloud.reown.com.

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Wallet',
      wallets: projectId ? [metaMaskWallet, rabbyWallet, walletConnectWallet] : [injectedWallet],
    },
  ],
  // projectId wajib diisi string oleh RainbowKit; hanya dipakai wallet WalletConnect di atas
  { appName: 'Depths', projectId: projectId || 'depths-injected-only' },
);

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors,
  transports: { [activeChain.id]: transportFor(activeChain) },
  pollingInterval: POLLING_MS,
  ssr: true,
});
