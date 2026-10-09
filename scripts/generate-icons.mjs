#!/usr/bin/env node
/**
 * 生成 PWA 图标（纯 Node，不引入图像处理依赖）。
 * 输出：public/icons/icon-{192,512}.png 与 icon-maskable-512.png
 * 图案：品牌色圆角方块 + 白色环形箭头 + 对勾，象征“重复练习并核对”。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
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

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
 * @param size 画布边长
 * @param maskable 是否按 maskable 规范留出安全区（图形缩到 60% 区域内）
 */
function drawIcon(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const unit = size / 512;
  const half = maskable ? size * 0.5 : size * 0.5;
  const corner = (maskable ? 150 : 112) * unit;
  // maskable 版本整体缩小，避免启动器裁切
  const mark = maskable ? 0.62 : 1;
  const ringOuter = 178 * unit * mark;
  const ringInner = 138 * unit * mark;
  const ringStroke = (ringOuter - ringInner) / 2;
  const gapFrom = (-40 / 360) * Math.PI * 2;
  const gapTo = (28 / 360) * Math.PI * 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const offset = (y * size + x) * 4;

      if (!inRoundedRect(dx, dy, half, corner)) {
        pixels[offset + 3] = 0;
        continue;
      }

      let color = mix(BRAND, BRAND_DARK, y / size);
      const distance = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const inGap = angle >= (gapFrom + Math.PI * 2) % (Math.PI * 2) || angle <= gapTo;

      if (Math.abs(distance - (ringOuter + ringInner) / 2) <= ringStroke && !inGap) color = INK;

      // 箭头头部：缺口起点处的三角形
      const headAngle = gapTo;
      const headRadius = (ringOuter + ringInner) / 2;
      const hx = Math.cos(headAngle) * headRadius;
      const hy = Math.sin(headAngle) * headRadius;
      if (Math.hypot(dx - hx, dy - hy) <= 30 * unit * mark) color = INK;

      // 对勾
      const u = unit * mark;
      if (onSegment(dx, dy, -76 * u, 4 * u, -24 * u, 56 * u, 15 * u)) color = INK;
      if (onSegment(dx, dy, -24 * u, 56 * u, 84 * u, -54 * u, 15 * u)) color = INK;

      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  return encodePng(size, pixels);
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
