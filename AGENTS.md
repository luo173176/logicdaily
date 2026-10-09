<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## LogicDaily 项目约定

- **领域层必须是纯函数**：`lib/domain/` 不碰 `window`、不 `fetch`、不读 `Date.now()`。当前日期（`DateKey`）与时间戳由调用方注入，`app/providers.tsx` 统一提供。
- **Dexie 的 `between()` 默认左闭右开**。所有日期区间查询必须显式传 `true, true`，否则「今天」的记录会被整段丢掉（已发生过这个 bug，`tests/integration/local-store.test.ts` 有端点回归用例）。
- **Service Worker 永不缓存 `/api/*`**（`public/sw.js`）。曾经缓存 `/api/ai/status` 导致配置后界面仍是未配置。
- **判分链路不调用大模型**。判分必须确定、可测、离线可用；AI 只在教练面板里用，失败不能阻断训练。
- **密钥只进服务端**：`AI_API_KEY` 等一律不带 `NEXT_PUBLIC_` 前缀，也不要写进 `next.config.ts` 的 `env`（会被打进浏览器包）。
- **加题必须过校验**：改 `content/exercises/*.json` 后跑 `npm run content:validate` 与 `npm run test -- tests/integration/content.test.ts`。正确选项不得挂 `errorType`，挂了的干扰项必须在解析里被解释。
- **端到端测试用固定深链接**（如 `/train?exercise=ex-cond-001`），不要依赖随日期变化的「今日计划」。
- **不夸大**：文档与界面文案要如实说明受限项（PWA 后台提醒、无 APK、云端同步未实现）。
- 提交前跑：`npm run typecheck && npm run lint && npm run content:validate && npm run test && npm run build`。
