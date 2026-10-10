#!/usr/bin/env node
/**
 * 生成应用图标（纯 Node，不引入图像处理依赖）。
 * 输出：public/icons/icon-{192,512}.png 与 icon-maskable-512.png
 * 图案：品牌色圆角方块 + 白色环形箭头 + 对勾，象征“重复练习并核对”。
 * 若仓库里已有 Capacitor 生成的 android/ 工程，一并替换启动器图标与闪屏，
 * 免得 APK 装着模板自带的第三方 logo。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('public/icons');
mkdirSync(OUT_DIR, { recursive: true });

const BRAND = [47, 93, 136];
const BRAND_DARK = [31, 62, 92];
const INK = [255, 255, 255];

function crc32(table, buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(CRC_TABLE, Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter none
    pixels.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeSquarePng(size, pixels) {
  return encodePng(size, size, pixels);
}

function mix(a, b, t) {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** 圆角矩形命中判定：dx/dy 相对中心，half 为半边长，corner 为圆角半径。 */
function inRoundedRect(dx, dy, half, corner) {
  const ax = Math.abs(dx) - (half - corner);
  const ay = Math.abs(dy) - (half - corner);
  if (ax <= 0 && ay <= 0) return true;
  if (ax <= 0) return ay <= corner;
  if (ay <= 0) return ax <= corner;
  return Math.hypot(ax, ay) <= corner;
}

/** 到线段距离小于 halfWidth 的点视为命中。 */
function onSegment(x, y, x1, y1, x2, y2, halfWidth) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = x - x1;
  const wy = y - y1;
  const lengthSquared = vx * vx + vy * vy;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared));
  return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)) <= halfWidth;
}

/**
 * 在画布上画品牌图案。
 * @param width 画布宽
 * @param height 画布高
 * @param options.clip 'rounded' 圆角方块（默认）| 'circle' 圆 | 'rect' 满幅
 * @param options.corner 圆角半径相对 512 画布的比例，仅 clip='rounded' 用到
 * @param options.background 'brand' 品牌渐变（默认）| 'transparent' 只画图案本身
 * @param options.ringOuter 环形箭头外半径占画布短边的比例；不传时用 178/512（maskable 时 0.62 倍）
 */
function paint(width, height, options = {}) {
  const { clip = 'rounded', corner = 112, background = 'brand' } = options;
  const short = Math.min(width, height);
  // 图案几何常量原本定义在 512 画布上（环半径 178），按比例换算到目标尺寸。
  const ringOuter = (options.ringOuter ?? 178 / 512) * short;
  const scale = ringOuter / 178;
  const ringInner = 138 * scale;
  const ringStroke = (ringOuter - ringInner) / 2;
  const headRadius = (ringOuter + ringInner) / 2;
  const gapFrom = (-40 / 360) * Math.PI * 2;
  const gapTo = (28 / 360) * Math.PI * 2;
  const cornerPx = corner * (short / 512);

  const pixels = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const offset = (y * width + x) * 4;

      if (clip === 'rounded' && !inRoundedRect(dx, dy, short / 2, cornerPx)) {
        continue;
      }
      if (clip === 'circle' && Math.hypot(dx, dy) > short / 2) {
        continue;
      }

      let color = background === 'brand' ? mix(BRAND, BRAND_DARK, y / height) : null;
      const distance = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const inGap = angle >= (gapFrom + Math.PI * 2) % (Math.PI * 2) || angle <= gapTo;

      if (Math.abs(distance - headRadius) <= ringStroke && !inGap) color = INK;

      // 箭头头部：缺口起点处的三角形
      const hx = Math.cos(gapTo) * headRadius;
      const hy = Math.sin(gapTo) * headRadius;
      if (Math.hypot(dx - hx, dy - hy) <= 30 * scale) color = INK;

      // 对勾
      if (onSegment(dx, dy, -76 * scale, 4 * scale, -24 * scale, 56 * scale, 15 * scale)) color = INK;
      if (onSegment(dx, dy, -24 * scale, 56 * scale, 84 * scale, -54 * scale, 15 * scale)) color = INK;

      if (!color) continue;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

/**
 * @param size 画布边长
 * @param maskable 是否按 maskable 规范留出安全区（图形缩到 60% 区域内）
 */
function drawIcon(size, maskable) {
  return encodeSquarePng(
    size,
    paint(size, size, {
      clip: 'rounded',
      corner: maskable ? 150 : 112,
      background: 'brand',
      ringOuter: (178 / 512) * (maskable ? 0.62 : 1),
    }),
  );
}

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const target of targets) {
  const buffer = drawIcon(target.size, target.maskable);
  writeFileSync(path.join(OUT_DIR, target.file), buffer);
  console.log(`✓ ${target.file} ${target.size}x${target.size} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

/**
 * Android 资源：启动器图标（含 adaptive icon 的前景色层）与闪屏。
 * 只有在 `npx cap add android` 之后才写，避免在纯 Web 克隆里凭空造目录。
 */
const RES_DIR = path.resolve('android/app/src/main/res');
if (existsSync(RES_DIR)) {
  // 尺寸取自 Android 官方密度基线：图标 48dp、adaptive 画布 108dp。
  const densities = [
    { dir: 'mdpi', launcher: 48, adaptive: 108, portrait: [320, 480] },
    { dir: 'hdpi', launcher: 72, adaptive: 162, portrait: [480, 800] },
    { dir: 'xhdpi', launcher: 96, adaptive: 216, portrait: [720, 1280] },
    { dir: 'xxhdpi', launcher: 144, adaptive: 324, portrait: [960, 1600] },
    { dir: 'xxxhdpi', launcher: 192, adaptive: 432, portrait: [1280, 1920] },
  ];
  // adaptive icon 的可信区是 108dp 里居中的 72dp（占短边 2/3），图案再缩一点留余量。
  const FOREGROUND_RATIO = 0.3;
  let written = 0;
  for (const density of densities) {
    const legacy = encodeSquarePng(density.launcher, paint(density.launcher, density.launcher, { corner: 112 }));
    writeFileSync(path.join(RES_DIR, `mipmap-${density.dir}`, 'ic_launcher.png'), legacy);
    const round = encodeSquarePng(
      density.launcher,
      paint(density.launcher, density.launcher, { clip: 'circle', ringOuter: (178 / 512) * 0.9 }),
    );
    writeFileSync(path.join(RES_DIR, `mipmap-${density.dir}`, 'ic_launcher_round.png'), round);
    // 前景层满幅铺品牌色：启动器把它裁成圆形/方形时，成品与 PWA 图标一致。
    const foreground = encodeSquarePng(
      density.adaptive,
      paint(density.adaptive, density.adaptive, { clip: 'rect', ringOuter: FOREGROUND_RATIO }),
    );
    writeFileSync(path.join(RES_DIR, `mipmap-${density.dir}`, 'ic_launcher_foreground.png'), foreground);

    const [portW, portH] = density.portrait;
    const splashRatio = (178 / 512) * 0.62;
    const portrait = encodePng(portW, portH, paint(portW, portH, { clip: 'rect', ringOuter: splashRatio }));
    writeFileSync(path.join(RES_DIR, `drawable-port-${density.dir}`, 'splash.png'), portrait);
    const landscape = encodePng(portH, portW, paint(portH, portW, { clip: 'rect', ringOuter: splashRatio }));
    writeFileSync(path.join(RES_DIR, `drawable-land-${density.dir}`, 'splash.png'), landscape);
    written += 5;
  }

  // adaptive icon 的背景色层：填不上前景的边角时用它，取品牌深色避免接缝。
  writeFileSync(
    path.join(RES_DIR, 'values', 'ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2F5D88</color>\n</resources>\n',
    'utf8',
  );
  console.log(`✓ android/ 资源：${written} 个 PNG（mipmap 各密度 3 张 + 闪屏横竖各 1 张）+ 背景色`);
} else {
  console.log('· 跳过 android/ 资源（还没有运行 npx cap add android）');
}
