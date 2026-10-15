import type { NextConfig } from "next";

// ブラウザからは同一オリジン(Next.js)の /api/* を呼び、Next.jsがGoバックエンドへ転送する。
// これにより viewer_session Cookie がファーストパーティのまま扱えるため、
// CORS設定やSameSite=Noneへの変更がGo側に不要になる。
const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  // Tailwind CSS v4をTurbopackで処理するための設定(create-next-appが生成したもの)
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  async rewrites() {
    return [
      // Goの合言葉ログインは /login にあるが、Next.js側の /login はログイン画面(SCR-001)が
      // 使うため、フロントからは /api/login として呼び分ける。
      { source: "/api/login", destination: `${backendOrigin}/login` },
      { source: "/api/logout", destination: `${backendOrigin}/logout` },
      { source: "/api/:path*", destination: `${backendOrigin}/api/:path*` },
      { source: "/auth/google/:path*", destination: `${backendOrigin}/auth/google/:path*` },
    ];
  },
};

export default nextConfig;
