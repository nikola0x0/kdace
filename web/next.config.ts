import type { NextConfig } from "next";

// externalDir lets the page import the shared core modules from ../src.
const nextConfig: NextConfig = { experimental: { externalDir: true } };

export default nextConfig;
