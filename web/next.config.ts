import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    // リポジトリ直下には Vercel デプロイ用の package.json が残っており、root で
    // npm install すると lockfile が復活して Next が workspace root を Alcon/ と
    // 誤推論する（globals.css の HMR 失効の原因）。root を web/ に固定して防ぐ。
    root: __dirname,
  },
};

export default nextConfig;
