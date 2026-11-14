import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The homepage (../website, copied by scripts/homepage.mjs). A signed-out
  // visitor to / is sent here; the app itself stays at /.
  async rewrites() {
    return [{ source: '/homepage', destination: '/homepage/index.html' }];
  },
  async headers() {
    // srcdoc apps still render, but cannot navigate their frame to an external
    // URL carrying private inputs. Inner CSP also blocks subresource requests.
    // The one frame allowed is an Element's attached file, previewed through
    // its signed link — the path, not the whole Supabase origin.
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
    const frameSrc = supabase ? `${supabase}/storage/v1/object/sign/element-files/` : "'none'";
    return [
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: `frame-src ${frameSrc}; object-src 'none'` }] },
      // The public MCP endpoint (app/mcp) is published as clayware.app/mcp
      // precisely so the Supabase project ref stays out of its URLs; the
      // catch-all CSP above would reintroduce the raw Supabase origin into
      // every /mcp response header. These later rules replace it with a
      // frame-less policy on the MCP and OAuth-metadata paths (they are
      // API responses, never framed documents).
      { source: '/mcp', headers: [{ key: 'Content-Security-Policy', value: "object-src 'none'" }] },
      { source: '/mcp/:path*', headers: [{ key: 'Content-Security-Policy', value: "object-src 'none'" }] },
      { source: '/.well-known/oauth-protected-resource', headers: [{ key: 'Content-Security-Policy', value: "object-src 'none'" }] },
      { source: '/.well-known/oauth-protected-resource/:path*', headers: [{ key: 'Content-Security-Policy', value: "object-src 'none'" }] },
      // A design downloaded as HTML loads its fonts from the app wherever it is
      // opened; fonts are fetched in CORS mode, so the app's own font files say
      // anyone may read them. They are public files with no user data.
      { source: '/design-fonts/:path*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
    ];
  },
  turbopack: {
    // リポジトリ直下には Vercel デプロイ用の package.json が残っており、root で
    // npm install すると lockfile が復活して Next が workspace root をリポジトリ直下と
    // 誤推論する（globals.css の HMR 失効の原因）。root を web/ に固定して防ぐ。
    root: __dirname,
  },
};

export default nextConfig;
