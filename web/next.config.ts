import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // srcdoc apps still render, but cannot navigate their frame to an external
    // URL carrying private inputs. Inner CSP also blocks subresource requests.
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-src 'none'; object-src 'none'" }] }];
  },
  turbopack: {
    // リポジトリ直下には Vercel デプロイ用の package.json が残っており、root で
    // npm install すると lockfile が復活して Next が workspace root を Alcon/ と
    // 誤推論する（globals.css の HMR 失効の原因）。root を web/ に固定して防ぐ。
    root: __dirname,
  },
};

export default nextConfig;
