import type { NextConfig } from 'next';

/**
 * 同一套源码支持两种构建目标：
 * - 默认（Web/服务器）：Cache Components + 部分预取，带 /api/ai/* 服务端代理。
 * - BUILD_TARGET=capacitor：静态导出，供 Capacitor 打包进 APK。
 *   静态导出没有 Node 运行时，因此 APK 内不含 AI 接口，应用会降级为「AI 教练未启用」。
 */
const isStaticExport = process.env.BUILD_TARGET === 'capacitor';

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? { output: 'export' as const, trailingSlash: true, images: { unoptimized: true } }
    : { cacheComponents: true, partialPrefetching: true }),
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
