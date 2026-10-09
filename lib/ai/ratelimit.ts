interface Bucket {
  hits: number[];
  daily: Map<string, number>;
}

/**
 * 单进程内存限流：对自托管单实例够用。多实例部署需要换成共享存储（Redis 等），
 * 这里把接口形状固定下来，替换只影响这个文件。
 */
const buckets = new Map<string, Bucket>();

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  usedToday: number;
}

export function checkRate(options: { key: string; perMinute: number; dailyLimit: number; dateKey: string; nowMs?: number }): RateDecision {
  const now = options.nowMs ?? Date.now();
  const bucket = buckets.get(options.key) ?? { hits: [] as number[], daily: new Map<string, number>() };
  bucket.hits = bucket.hits.filter((ts) => now - ts < 60_000);

  const usedToday = bucket.daily.get(options.dateKey) ?? 0;
  if (options.dailyLimit <= 0) {
    return { allowed: false, retryAfterSeconds: 0, remaining: 0, usedToday };
  }
  if (usedToday >= options.dailyLimit) {
    return { allowed: false, retryAfterSeconds: 3600, remaining: 0, usedToday };
  }
  if (bucket.hits.length >= options.perMinute) {
    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (now - oldest)) / 1000)),
      remaining: 0,
      usedToday,
    };
  }

  bucket.hits.push(now);
  bucket.daily.set(options.dateKey, usedToday + 1);
  buckets.set(options.key, bucket);
  prune();
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, options.perMinute - bucket.hits.length),
    usedToday: usedToday + 1,
  };
}

export function rateSnapshot(): { keys: number; requestsLastMinute: number } {
  let total = 0;
  const now = Date.now();
  for (const bucket of buckets.values()) total += bucket.hits.filter((ts) => now - ts < 60_000).length;
  return { keys: buckets.size, requestsLastMinute: total };
}

export function resetRateState(): void {
  buckets.clear();
}

function prune(): void {
  if (buckets.size < 512) return;
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.hits.every((ts) => now - ts >= 60_000)) buckets.delete(key);
  }
}
