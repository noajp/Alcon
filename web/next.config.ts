import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // srcdoc apps still render, but cannot navigate their frame to an external
    // URL carrying private inputs. Inner CSP also blocks subresource requests.
    return [
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-src 'none'; object-src 'none'" }] },
      // A design downloaded as HTML loads its fonts from the app wherever it is
      // opened; fonts are fetched in CORS mode, so the app's own font files say
      // anyone may read them. They are public files with no user data.
      { source: '/design-fonts/:path*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
    ];
  },
  turbopack: {
    // リポジトリ直下には Vercel デプロイ用の package.json が残っており、root で
    // npm install すると lockfile が復活して Next が workspace root を Alcon/ と
    // 誤推論する（globals.css の HMR 失効の原因）。root を web/ に固定して防ぐ。
    root: __dirname,
  },
};

export default nextConfig;
