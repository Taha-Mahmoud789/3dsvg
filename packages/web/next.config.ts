import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["3dsvg"],
  serverExternalPackages: ["potrace", "sharp"],
};

export default nextConfig;
