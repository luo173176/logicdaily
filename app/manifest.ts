import type { MetadataRoute } from 'next';

import manifestData from '@/content/app-manifest.json';

/**
 * 单一数据源是 content/app-manifest.json：
 * Web 构建由 Next 生成 /manifest.webmanifest，APK 构建则由
 * scripts/build-apk-web.mjs 把同一份 JSON 落成 public/manifest.webmanifest。
 */
export default function manifest(): MetadataRoute.Manifest {
  return manifestData as MetadataRoute.Manifest;
}
