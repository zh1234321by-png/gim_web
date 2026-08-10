import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 生产环境优化：输出 standalone 模式，减少部署体积 */
  allowedDevOrigins: ['192.168.1.52'],
  output: "standalone",

  /* 图片优化配置 */
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "8.130.47.186",
      },
    ],
  },

  /* 实验性功能（按需启用） */
  // experimental: {
  //   serverActions: true,
  // },

  /* 构建时忽略 ESLint 错误（可选，根据需要调整） */
  // eslint: {
  //   ignoreDuringBuilds: true,
  // },

  /* 构建时忽略 TypeScript 错误（可选，根据需要调整） */
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
};

export default nextConfig;
