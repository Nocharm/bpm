import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 멀티스테이지 빌드에서 node_modules 없이 실행 가능한 산출물 생성
  output: "standalone",
  // 로컬 네이티브 개발(Docker/nginx 없음)에서 /api를 backend로 프록시.
  // 운영(서버)에서는 nginx가 /api를 backend로 직접 라우팅하므로 이 rewrites에 도달하지 않음.
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
