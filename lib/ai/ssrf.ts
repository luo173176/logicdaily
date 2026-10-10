import { lookup } from 'node:dns/promises';

import { isIP } from 'node:net';

// joinChatCompletions 的唯一实现在 provider-core（客户端也要用），这里转发出去保持既有导入路径可用。
export { joinChatCompletions } from '@/lib/ai/provider-core';

export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UnsafeUrlError';
  }
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToLong(value: string): number {
  const parts = value.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const numeric = ipv4ToLong(address);
    return PRIVATE_V4.some(([prefix, bits]) => {
      const base = ipv4ToLong(prefix);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (numeric & mask) >>> 0 === (base & mask) >>> 0;
    });
  }
  if (version === 6) {
    const lowered = address.toLowerCase();
    if (lowered === '::1') return true;
    // IPv4 映射地址 ::ffff:a.b.c.d
    const mapped = lowered.match(/^::ffff:([\d.]+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    const first = lowered.split(':')[0] ?? '';
    const head = Number.parseInt(first.slice(0, 4) || '0', 16);
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 本地唯一地址
    if (/^fe[89ab]/.test(lowered)) return true; // fe80::/10 链路本地
    if (lowered === '::') return true;
    return false;
  }
  // 无法识别的写法一律按不安全处理。
  return true;
}

function normalizeAllowEntry(entry: string): URL | null {
  try {
    return new URL(entry.includes('://') ? entry : `https://${entry}`);
  } catch {
    return null;
  }
}

export function isUrlAllowlisted(candidate: string, allowlist: string[]): boolean {
  let target: URL;
  try {
    target = new URL(candidate);
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    const allowed = normalizeAllowEntry(entry);
    if (!allowed) return false;
    if (target.protocol !== allowed.protocol) return false;
    if (target.host !== allowed.host) return false;
    // 允许更深的路径，但不允许跳出允许的前缀目录。
    const allowedPath = allowed.pathname.replace(/\/$/, '');
    const targetPath = target.pathname.replace(/\/$/, '');
    return allowedPath === '' || targetPath === allowedPath || targetPath.startsWith(`${allowedPath}/`);
  });
}

export interface SafeRequestTarget {
  url: URL;
  hostname: string;
  addresses: string[];
}

/**
 * 出站请求前的强制检查：协议、凭据、允许列表、DNS 解析结果。
 * 只允许 https（本机测试可显式放行 http://127.0.0.1，见 allowLoopback）。
 */
export async function resolveSafeTarget(rawUrl: string, allowlist: string[], options?: { allowLoopback?: boolean }): Promise<SafeRequestTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('地址无法解析。');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeUrlError('只允许 http/https。');
  if (url.username || url.password) throw new UnsafeUrlError('地址中不允许包含凭据。');
  // 显式端口只在本机测试模式下允许，避免把服务端变成任意内网端口探测器。
  if (url.port && options?.allowLoopback !== true) throw new UnsafeUrlError('不允许使用显式端口。');
  if (url.protocol === 'http:' && options?.allowLoopback !== true) throw new UnsafeUrlError('生产环境要求 https。');

  if (!isUrlAllowlisted(url.toString(), allowlist)) {
    throw new UnsafeUrlError('该地址不在服务端允许列表中。');
  }

  if (!isIP(url.hostname)) {
    let records: { address: string; family: number | string }[];
    try {
      records = await lookup(url.hostname, { all: true, verbatim: true });
    } catch {
      throw new UnsafeUrlError('域名解析失败。');
    }
    const addresses = records.map((record) => record.address);
    if (addresses.length === 0) throw new UnsafeUrlError('没有解析到地址。');
    const unsafe = addresses.find((address) => isPrivateAddress(address));
    if (unsafe) {
      if (options?.allowLoopback === true && (unsafe === '127.0.0.1' || unsafe === '::1')) {
        return { url, hostname: url.hostname, addresses };
      }
      throw new UnsafeUrlError('目标解析到内网或保留地址，已拒绝。');
    }
    return { url, hostname: url.hostname, addresses };
  }

  if (isPrivateAddress(url.hostname) && !(options?.allowLoopback === true && (url.hostname === '127.0.0.1' || url.hostname === '::1'))) {
    throw new UnsafeUrlError('目标是内网或保留地址，已拒绝。');
  }
  return { url, hostname: url.hostname, addresses: [url.hostname] };
}
