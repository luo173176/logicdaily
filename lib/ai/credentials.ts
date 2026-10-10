/**
 * 直连模式的 API Key 存储。
 *
 * 为什么不放进 settings 记录：
 * 1. `migrateSettings()` 在每次应用启动和每次 getSettings 时都会跑，并且会主动删掉
 *    任何 `apiKey` / `key` / `token` 字段（那是为导入备份准备的防线）。密钥放在 settings 里
 *    会在下一次加载时被自己抹掉。
 * 2. settings 是备份导出的一部分。密钥不该写进用户会转发、会上传、会提交到 Git 的文件。
 *
 * 所以密钥单独放 localStorage：它天然不在 Dexie 的导出清单里，「不进备份」是结构保证，
 * 不依赖某段代码记得去剥离。代价是明文存储 —— 这一点必须在界面上向用户说清楚。
 */

const KEY_PREFIX = 'logicdaily:ai-key:';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // 隐私模式下访问 localStorage 会抛错。
    return null;
  }
}

export function readAiKey(profileId: string): string {
  return storage()?.getItem(KEY_PREFIX + profileId) ?? '';
}

export function writeAiKey(profileId: string, apiKey: string): void {
  const store = storage();
  if (!store) return;
  if (apiKey) store.setItem(KEY_PREFIX + profileId, apiKey);
  else store.removeItem(KEY_PREFIX + profileId);
}

export function clearAiKey(profileId: string): void {
  storage()?.removeItem(KEY_PREFIX + profileId);
}

/** 「清除本地数据」要把所有 profile 的密钥一起去掉。 */
export function clearAllAiKeys(): void {
  const store = storage();
  if (!store) return;
  const doomed: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key && key.startsWith(KEY_PREFIX)) doomed.push(key);
  }
  for (const key of doomed) store.removeItem(key);
}

/** 界面上显示用的指纹：只暴露长度与首尾各 2 字符，永远不返回原文。 */
export function maskAiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return `已保存 ${apiKey.length} 位`;
  return `${apiKey.slice(0, 2)}…${apiKey.slice(-2)}（${apiKey.length} 位）`;
}
