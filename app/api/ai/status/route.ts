import { NextResponse, connection } from 'next/server';

import { publicAiStatus, readServerAiConfig } from '@/lib/ai/config';
import { AI_TASKS } from '@/lib/ai/output-schema';
import { PROMPT_REGISTRY_VERSION } from '@/lib/ai/prompts';

export async function GET() {
  // 这个处理器不读请求，会被预渲染并在 CDN/浏览器里长期缓存，
  // 于是「刚配好 Key」的实例仍然对所有人返回未配置。等到真正有请求进来再取值。
  await connection();
  const config = readServerAiConfig();
  return NextResponse.json({
    ok: true,
    tasks: AI_TASKS,
    prompts: PROMPT_REGISTRY_VERSION,
    ...publicAiStatus(config),
  });
}
