import type { CapacitorConfig } from '@capacitor/cli';

/**
 * APK 打包配置。
 *
 * webDir 指向 scripts/build-apk-web.mjs 产出的静态导出结果：
 * 那是一份**没有 Node 服务端**的构建，因此 APK 内 AI 思维教练不可用，
 * 应用会显示「AI 教练未启用」，其余功能（题库、答题、归因、思考日志、复习、报告、备份）完整。
 */
const config: CapacitorConfig = {
  appId: 'com.logicdaily.app',
  appName: 'LogicDaily',
  webDir: 'apk-web',
  backgroundColor: '#f6f6f4',
  android: {
    allowMixedContent: false,
  },
  server: {
    // 不设置 url：内容从打包进 APK 的本地资源加载，保证离线可用。
    androidScheme: 'https',
  },
};

export default config;
