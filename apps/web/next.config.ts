import type { NextConfig } from "next";

// Dynamic import opsional di @coinbase/cdp-sdk yang tidak dipakai Depths (lihat lib/stubs/x402.ts)
const X402_STUB = "./lib/stubs/x402.ts";
const x402Aliases = Object.fromEntries(
  ["@x402/core/client", "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client", "@x402/svm/exact/client"].map(
    (m) => [m, X402_STUB],
  ),
);

const nextConfig: NextConfig = {
  // game-logic diekspor sebagai source TS
  transpilePackages: ["game-logic"],
  turbopack: {
    resolveAlias: x402Aliases,
  },
};

export default nextConfig;
