import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // game-logic diekspor sebagai source TS
  transpilePackages: ["game-logic"],
};

export default nextConfig;
