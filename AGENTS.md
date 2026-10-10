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
- **不夸大**：文档与界面文案要如实说明受限项（PWA 后台提醒、APK 未真机验证、云端同步未实现）。构建产物要拿真实输出证明，不臆测「应该能成功」。
- **两个构建目标共用一份源码**：`next.config.ts` 按 `BUILD_TARGET=capacitor` 切换 `output: 'export'` 与 `cacheComponents`（两者互斥，且 Next 16 的 `next build` 没有 `-c` 参数）。APK 侧由 `scripts/build-apk-web.mjs` 把源码复制进 `.apk-src/` 再导出，**不要**在仓库里删除或改动 `app/api` —— 那是 SSRF 防护、密钥隔离、限流的安全边界。
- **静态导出的限制**：不能用依赖 `Request` 的 Route Handler、不能用无 `generateStaticParams()` 的动态段、`useSearchParams()` 需要 `<Suspense>` 边界、元数据路由（`app/manifest.ts`）要落成静态文件。所以日志编辑是 `/journal?edit=<id>` 而不是 `/journal/[id]`，manifest 数据在 `content/app-manifest.json` 单一来源。
- **改会影响 APK 的东西就跑两遍**：动了路由/manifest/AI 客户端 → `npm run build:apk-web && npm run verify:apk-web`，外加 `npx playwright test`。
- **Android 侧的本地文件不提交**：`android/local.properties`（`sdk.dir` **必须用正斜杠**，反斜杠转义会让 Gradle 在 `SdkLocator` 处抛 `java.io.IOException`）、`android/**/build/`、`*.apk`、`android/app/src/main/assets/public` 都在 `.gitignore` 里；APK 走 GitHub Release 分发，不进工作树。
- 提交前跑：`npm run typecheck && npm run lint && npm run content:validate && npm run test && npm run build`，以及 `npm run format:check`（Prettier 配置在 `.prettierrc.json`，Markdown 表格由它统一对齐）。
