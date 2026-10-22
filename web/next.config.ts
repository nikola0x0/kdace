import { join } from "node:path";
import type { NextConfig } from "next";

// externalDir lets the page and API routes import the shared core modules from ../src.
// Packages those modules import (e.g. @mysten/sui in ../src/core/sui.ts) resolve from web/node_modules first, so the
// build doesn't depend on the repo root's node_modules (absent on Vercel) and bundles one copy of each package.
const nextConfig: NextConfig = {
  experimental: { externalDir: true },
  webpack: (config) => {
    config.resolve.modules = [join(process.cwd(), "node_modules"), ...(config.resolve.modules ?? ["node_modules"])];
    return config;
  },
};

export default nextConfig;
