/**
 * 构建 APK 用的前端资源（纯离线，无 Node 服务端）。
 *
 * 为什么需要这个脚本：APK 里跑不了 Next 的 Route Handler，而 `output: 'export'`
 * 与 `cacheComponents` 互斥（导出要求路由声明 force-static，Cache Components 又拒绝
 * 任何 dynamic 段配置）。同一份 app/api 下的 route.ts 无法同时满足两种构建目标，
 * 所以这里把源码复制到一个构建目录、在副本中排除服务端路由后再导出。
 * 仓库本体不受任何影响，`.apk-src/` 与 `apk-web/` 都是可再生的构建产物。
 *
 * 用法：node scripts/build-apk-web.mjs
 * 产物：apk-web/  ← Capacitor 的 webDir
 */
import { copyFileSync, cpSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, '.apk-src');
const OUT_DIR = join(SRC_DIR, 'out');
const WEB_DIR = join(ROOT, 'apk-web');

/**
 * 不进副本的东西：
 * - 依赖与产物由外部提供；
 * - app/api 是 APK 里不存在的服务端能力；
 * - app/manifest.ts 是元数据路由，静态导出同样要求 force-static，
 *   改为把同一份 JSON 落成 public/manifest.webmanifest。
 */
const EXCLUDE_TOP = new Set(['node_modules', '.next', '.git', '.apk-src', 'apk-web', 'out', 'android', 'test-results', 'playwright-report', 'coverage', 'docs']);
const EXCLUDE_APP = new Set(['api', 'manifest.ts']);

function excluded(relativePath) {
  if (!relativePath) return false;
  const parts = relativePath.split(sep);
  if (EXCLUDE_TOP.has(parts[0])) return true;
  if (parts[0] === 'app' && EXCLUDE_APP.has(parts[1])) return true;
  if (relativePath.endsWith('tsconfig.tsbuildinfo')) return true;
  return false;
}

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += countFiles(full);
    else total += 1;
  }
  return total;
}

function byteSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? byteSize(full) : statSync(full).size;
  }
  return total;
}

/**
 * 手工递归复制：cpSync 拒绝把目录复制进自身的子目录，而副本需要留在仓库内
 * 才能沿目录树向上解析到 node_modules。
 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    if (excluded(relative(ROOT, source))) continue;
    const target = join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else copyFileSync(source, target);
  }
}

console.log('[1/4] 准备无服务端源码副本 …');
rmSync(SRC_DIR, { recursive: true, force: true });
copyTree(ROOT, SRC_DIR);

// 副本没有 app/api，生成的路由类型会引用不存在的模块，清掉旧的构建缓存。
rmSync(join(SRC_DIR, 'next-env.d.ts'), { force: true });

// 元数据路由在导出里不被允许，改用静态文件；数据仍来自同一份 content/app-manifest.json。
copyFileSync(join(SRC_DIR, 'content', 'app-manifest.json'), join(SRC_DIR, 'public', 'manifest.webmanifest'));

console.log('[2/4] 静态导出 …');
execFileSync(process.execPath, [join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
  cwd: SRC_DIR,
  stdio: 'inherit',
  // next.config.ts 自己按 BUILD_TARGET 切换导出目标，这里不再另写一份配置，避免两处漂移。
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', BUILD_TARGET: 'capacitor' },
});

if (!existsSync(OUT_DIR)) {
  console.error('导出失败：没有生成 out/ 目录');
  process.exit(1);
}

console.log('[3/4] 同步到 apk-web/ …');
rmSync(WEB_DIR, { recursive: true, force: true });
mkdirSync(WEB_DIR, { recursive: true });
cpSync(OUT_DIR, WEB_DIR, { recursive: true });

const files = countFiles(WEB_DIR);
const bytes = byteSize(WEB_DIR);
console.log(`[4/4] 完成：apk-web/ 共 ${files} 个文件，${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log('下一步：npx cap sync android');
