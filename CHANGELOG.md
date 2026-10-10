# 更新日志

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [Unreleased]

_暂无。_

## [1.1.0] - 2026-10-10

这一版只做一件事：让 App 里真的能把 AI 配起来。触发点是 v1.0.0 装上真机之后的两条使用者反馈——第一条是一个降级 bug（已在 1.0.x 修掉），第二条是「AI 教练配置不了啊，API key 呢」。

### 新增

- **AI 本机直连模式**（`ai.mode = 'direct'`，用户显式开启）：请求从这台设备直接发给使用者自己填的服务商，
  因此纯离线包（APK）与静态托管里也能用上 AI。仍然强制 https（`127.0.0.1` / `localhost` / `::1` 除外）、
  URL 内不得携带凭据、`redirect: 'error'` 不跟随重定向；提示词、输入上限、输出契约与错误种类与代理模式
  **共用同一份** `lib/ai/tasks.ts`，直连不会偷偷放宽校验。明确没有的防护也写清楚：不做 DNS 私网检查、
  没有服务端权威配额与每分钟窗口、没有服务端日志（部署者看不到这类调用）。见 `docs/AI_INTEGRATION.md` 3.6、`SECURITY.md` 2.7。
- **API Key 的独立存放**（`lib/ai/credentials.ts`）：只存 `localStorage` 的 `logicdaily:ai-key:<profileId>`，
  不进 `settings` 记录，因此**结构上不可能出现在导出备份里**（`migrateSettings()` 本来就会在每次加载时删掉
  `apiKey`/`key`/`token`，密钥放进设置会被自己抹掉）。界面默认遮罩输入框、只显示首尾各 2 字符与长度的指纹、
  「清除本机密钥」与「清除本地数据」都会删掉所有 profile 的密钥。端到端与包内验证都真的导出一次备份文件并断言搜不到那串 Key。
- **AI 设置界面重写**（`features/me/ai-settings.tsx`）：「请求怎么走」模式切换、两种模式各自的说明、
  Base URL 与模型名称改为自由填写、8 个预设只作快捷方式（点一下填入、之后可改）、按草稿测连通性的「测试连接」、
  以及直连模式的代价说明（明文在设备上、不进备份、无服务端配额、需要服务商允许跨域；实测 DeepSeek、Kimi、通义、
  StepFun、SiliconFlow 允许浏览器跨域，智谱不允许）。
- **CI 增加离线静态包任务**：`npm run build:apk-web` + `npm run verify:apk-web`，让「导出目标」与直连通路在 CI 里就被盯住。

### 修复

- **纯离线包里教练按钮永远点不动**：`CoachPanel` 与材料分析页用本站 `/api/ai/status` 的结果判断是否就绪，
  而直连模式下这个接口不存在，即使地址、模型、密钥都填齐了也只会看到「这里连不上 AI 接口」。就绪判断改为按模式分流
  （`directReadiness()`），直连下不再查询状态接口，缺件时给出「直连还差一步：还缺什么」的具体提示且不出站。
- **自定义 Base URL 后用量记录仍写着预设供应商**：改动地址时把 `ai.provider` 归为 `custom`，
  避免 `aiUsage.provider` 与实际出站目标不一致。

### 变更

- `settings.ai` 新增 `mode`（默认 `server`）与 `baseUrl`；移除只做展示的 `baseUrlLabel`；「提供商」由下拉框变成快捷方式按钮。
  旧备份经 `migrateSettings()` 浅合并升级，缺字段自动补默认值。
- `lib/ai/provider.ts` 只保留服务端的出站前检查（SSRF），HTTP/解析/重试实现移进客户端可导入的 `lib/ai/provider-core.ts`；
  任务定义与契约在 `lib/ai/tasks.ts`。两种模式共用，不存在两份实现漂移。

### 测试

- 新增 15 个单元测试（地址形状检查、缺件不出站、`Bearer` 头与 `/chat/completions` 路径、不跟随重定向、
  契约不符即丢弃、密钥存放与清除范围）与 5 个端到端用例（起一个真实的本地跨源 mock 服务商，走完
  「设置里填直连 → 测试连接 → 保存 → 教练页拿到结构化分析」）。`npm run verify:apk-web` 由 15 项增加到 22 项，
  其中包含在无 Node 服务端的包内完成一次跨源直连调用。**没有用真实付费 Key 打过真实服务商。**

## [1.0.0] - 2026-10-09

首个版本。两条分发路径都在：可自托管的 PWA（含 AI 教练），以及可直接安装的纯离线 APK。

### 新增

- **本地优先数据层**：Dexie（IndexedDB）13 个对象仓库，全部按 `profileId` 隔离；`DataStore` 接口为将来的云端实现留接缝，`syncState` 已记录 `localRevision` 与 `pendingOps`。
- **题库**：14 个题型 × 8 题 = 112 道原创中文题。每题含题干、答案、解析、推理步骤、典型错误、可接受其他答案、知识点标签、来源与版本。
- **内容校验**：`npm run content:validate` 检查 id 规范、枚举合法性、正确项不得携带错误类型标签、干扰项必须被解析解释、简答题关键词必须出现在参考答案中、排序题答案必须是全排列、重复 id 与重复题干检测。
- **6 种作答形式与判分**：单选、多选（漏选/错选分列）、判断、简答（检查点关键词覆盖率）、开放作答（自评量表，不污染正确率统计）、排序（Kendall 一致性比例 + 题目级容差）。
- **错因归类**：15 种逻辑错误类型 + 显式优先级归因链，区分推理方式问题 / 知识缺口 / 粗心 / 读错题 / 题目歧义；用户可补自述标签（只改归因，不改得分与排期）；标记歧义的题目进入题库复核清单。
- **间隔复习 LD-SRS**：SM-2 派生，难度加权首次间隔、答错当日重学（30 分钟后）、45 天间隔上限、连错 leech 标记；复习页用人话解释排期理由。
- **知识点掌握度**：EWMA + 置信度与难度加权，`weaknessScore` 驱动新题选择。
- **确定性每日计划**：`makeRng(dateKey + profileId)` 带种子，同一天重跑结果一致；优先级为当日重学 → 到期复习 → 到期日志复盘 → 加权新题 → 一篇日志。
- **思考日志**：八步向导（问题 / 背景 / 事实与推测 / 假设 / 结论 / 另一种解释 / 关键不确定 / 验证动作）+ 证据清单（立场、可靠性自评、来源）+ 状态机与到期复盘 + 完成度百分比 + 软删除与彻底删除 + 单篇导出。
- **训练报告**：正确率、平均得分、平均用时、任务完成率、复习后表现变化、反面证据记录比例、知识点掌握度、错误类型分布与跨题重复率、连续训练天数（1 天宽限、休息日不断连击）。每项都带「怎么算」与样本不足阈值（趋势前后各 12 次、复习效果 6 组配对），页面固定说明「这些数字不能说明什么」。
- **AI 思维教练（可选）**：6 个任务类型（推理分析、日志审阅、材料分析、练习推荐、周度小结、连通自检），默认苏格拉底式，输出经 Zod 契约校验，提示词模板独立存放并带版本号，响应元数据回传 `promptVersion`。
- **AI 安全层**：服务端密钥隔离、SSRF 允许列表 + DNS 私有段拒绝（含云元数据地址）、同源检查、每分钟与每日限额、输入长度与输出 token 上限、超时与指数退避重试、用量记录、日志脱敏。
- **数据管理**：JSON 备份导出/导入（结构 + 应用标识 + 版本校验，导入设置时剥离 `apiKey`/`key`/`token`），一键清除本地数据。
- **移动端优先 PWA**：manifest（standalone、竖屏、快捷方式）、手写 Service Worker（页面外壳 stale-while-revalidate、静态资源 cache-first、`/api/*` 永不缓存）、更新提示不自动接管、纯 Node 脚本生成图标（无图像依赖）、深浅色主题无闪烁切换、安全区与键盘避让。
- **两种构建目标（Web 与 APK）**：`next.config.ts` 按 `BUILD_TARGET=capacitor` 在 `cacheComponents` 与 `output: 'export'` 之间切换（两者互斥，Next 16 的 `next build` 又没有 `-c` 参数）。`scripts/build-apk-web.mjs` 把源码复制进 `.apk-src/`，**只在副本里**排除 `app/api` 与 `app/manifest.ts`（服务端路由是 SSRF/密钥隔离/限流所在，仓库本体不动），导出结果同步到 `apk-web/` 作为 Capacitor 的 `webDir`。manifest 数据抽成 `content/app-manifest.json` 单一来源，两条路共用。
- **纯离线单机 APK**：`android/` 由 `npx cap add android`（Capacitor 6.2.2，选它是因为本机 JDK 17 而 8.x 要求 JDK 21）生成，`capacitor.config.ts` **不设** `server.url` 因此从包内本地资源加载，`androidScheme: 'https'`、`allowMixedContent: false`，清单只声明 `android.permission.INTERNET`。Gradle `assembleDebug` 实测 `BUILD SUCCESSFUL in 1m 29s`（82/82 tasks），产物 4,303,043 字节，`aapt2` 核验 `com.logicdaily.app` versionCode 1 / versionName 1.0 / minSdk 22 / target 34 / compileSdk 34，包内 93 个 `assets/public/*` 与 `apk-web/` 的 91 个文件逐路径一致（另 2 个是 Capacitor 注入的桥接文件）。**APK 内 AI 教练不可用**（没有 Node 服务端），界面显示「未启用」。
- **APK 资源的功能验证**：`scripts/verify-apk-web.mjs` 用静态服务器托管 `apk-web/` 并用 Playwright 跑 15 项检查（首页引导、112 题随包播种、题目深链接、提交判分、AI 优雅降级、`/journal?edit=` 的保存/刷新/列表/进入、5 条路由无横向溢出）。实测 15/15 通过。注意这验证的是打进包内的那份资源，**不是**安装后的 App —— APK 从未在真机或模拟器上运行（`adb devices` 为空）。
- **APK 的启动器图标与闪屏**：`scripts/generate-icons.mjs` 在 `android/` 存在时覆写 25 个 PNG（各密度 `ic_launcher` / `ic_launcher_round` / adaptive 前景层 + 横竖闪屏）与 `ic_launcher_background` 颜色，替换 `cap add` 带来的 Capacitor 模板 logo；重构绘制函数后 PWA 那 4 个 PNG 的输出逐字节不变。
- **发布包从 clean 构建**：AGP 的增量打包在条目变小时不回收旧位置，实测同一份代码的增量包比干净包多 429,429 字节死空间（11 个条目后面有空洞）。本文与文档引用的字节数都对应 `clean assembleDebug` 的产物。
- **干净副本可复现**：从 GitHub 下载的 tarball 里重跑 `npm ci` → `build:apk-web` → `cap sync` → `assembleDebug` 全部成功（91 个资源文件、包内 578 个条目、`aapt2` 元数据与本机一致），确认构建没有依赖本地遗留产物。
- **测试**：220 个单元/集成测试（Vitest + fake-indexeddb）+ 17 个端到端测试（Playwright，Pixel 7 视口），覆盖引导、答题与解析、错因与歧义标记、复习说明、刷新后持久化、日志增删改查与向导、报告指标、导出→清除→导入、非法导入被拒、AI 三种降级、横向溢出与输入遮挡。
- **CI**：`.github/workflows/ci.yml`，先跑类型检查、ESLint、内容校验、单元/集成测试与生产构建，再跑端到端测试并在失败时保留报告。
- **每日额度的本机自检**：教练面板与材料分析在发请求前检查本机当天用量，达到「我的」里设定的上限就不再发送（服务端 `AI_DAILY_LIMIT` 仍是权威）。此前该设置项完全不生效，界面却写着「两侧都会检查」。
- **枚举副本防漂移**：`scripts/validate-exercises.mjs` 需要的题型/错误类型枚举抽到 `scripts/content-enums.mjs`，并由 `tests/integration/content.test.ts` 与 `lib/domain/taxonomy.ts` 逐项比对（校验脚本是纯 Node，无法导入 TS，只能维护副本）。
- **当日提醒执行端**：`components/reminder-gate.tsx` 在应用打开时按分钟检查，命中条件时给出页内横幅，系统通知已授权时同时弹出；决策逻辑（免打扰跨午夜、休息日、每日一次、2 小时窗口）在 `lib/services/reminders.ts`，15 个单元测试覆盖。
- **云端模式 SQL（未接入应用）**：`supabase/migrations/` 含 13 张表与 29 条索引、RLS 每用户隔离策略（49 条策略）、由题库生成的幂等种子（112 行），以及仅用于本地验证的 `auth` 桩文件。已在 Docker 里的 PostgreSQL 16 上验证：四个迁移在空库上干净执行、题库种子 112 行、跨用户读写不可见（含 UPDATE/DELETE 影响 0 行、越权写入被策略拒绝、客户端对题库表 `permission denied`）。
- **文档**：`README.md` 与 `docs/` 下的架构、数据模型、产品规格、AI 接入、隐私、部署、Android 说明，另有 `SECURITY.md`、`CONTRIBUTING.md` 与本文件。

### 修复

- **APK 里 AI 降级文案漏出 JSON 解析错误**（第一条真机实测反馈）：「我的 → AI 教练」显示 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`。根因是 Capacitor 的 `WebViewLocalServer` 默认 `html5mode = true`，任何最后一段不含点的路径（包括 `/api/ai/status`）都被兜底成应用自己的 `index.html` 并返回 **200**，于是 `!response.ok` 判定不成立、`response.json()` 抛错，而 catch 分支把 `error.message` 原样丢给了界面。现在 `readAiStatus()` 按内容类型判定并给出设计好的说明，`callTask()` 区分「没有服务端」与「模型返回结构不对」（原先后者会被误报成模型的问题），教练面板标题在不可达时改为「这里连不上 AI 接口」。同时把 `scripts/verify-apk-web.mjs` 的静态服务器改成复刻 html5mode 兜底（它之前对未知路径返回 404，正好绕过了这个 bug），新增 `/me/` 与 `/coach/` 两条降级断言，并补 `tests/unit/ai-client.test.ts` 9 个用例覆盖这几种响应形态。

- **AI 状态接口被预渲染并长期缓存**：`/api/ai/status` 不读请求，在 `cacheComponents` 下于构建期求值，返回 `x-nextjs-cache: HIT` 与 `cache-control: s-maxage=31536000`，导致运维配好模型 Key 之后界面仍对所有人显示「AI 未启用」。改为在取值前 `await connection()`（`export const dynamic = 'force-dynamic'` 在 `cacheComponents` 下会被构建拒绝），路由表现已变为 `ƒ (Dynamic)`。
- **安全区 CSS 完全不生效**：`app/globals.css` 与底部导航都用了 `env(safe-area-inset-*)`，但 meta viewport 缺 `viewport-fit=cover`，这些值在移动浏览器里解析为 0。已在 `app/layout.tsx` 的 `viewport` 导出补上。
- **提醒决策是死代码**：`decideReminder()` 与 `nextReminderOccurrence()` 没有任何调用点，「我的」页只请求了通知权限，实际不会提醒。新增 `components/reminder-gate.tsx` 在应用打开时按分钟检查并给出页内横幅 + 系统通知（已授权时），每天最多一次。
- **限流身份可被伪造**：`actorKey()` 原先无条件信任 `x-forwarded-for` / `x-real-ip`，Node 直接暴露时任何人都能换限流身份；而完全没有这些头时全站共享一个桶。现在只有运维显式设置 `TRUST_PROXY_HEADERS` 才读取对应头，未配置时归入固定的 `shared` 桶。`.env.example` 的说明同步更正。
- **模板里的空变量**：`NEXT_PUBLIC_APP_URL` 声明了但无代码读取，已从 `.env.example` 移除。
- **报告页看不到当天的作答记录**：Dexie 的 `between()` 默认左闭右开，`[profileId+dateKey]` 区间查询把上界当天整段排除，表现为「已提交成功但报告页永远显示还没有作答记录」。所有日期区间查询显式使用闭区间，并在 `tests/integration/local-store.test.ts` 加了端点回归用例。
- **首次打开时今日计划为空**：题库播种尚未完成就生成了计划并持久化，导致首页显示「今天的任务已经完成 / 已完成 0 项」。现在 `ready` 在播种完成后才置位，题库为空时不落库并给出可操作的提示与「重新载入题库」按钮。
- **新建日志后刷新丢失**：保存后地址栏仍停在 `/journal/new`，刷新即丢内容。首存之后改为 `router.replace('/journal?edit=<id>')`。
- **日志路由改为查询参数（静态导出的前置条件）**：`app/journal/[id]/page.tsx` 动态段在 `output: 'export'` 下必须有非空的 `generateStaticParams()`，而日志 id 属于本机数据、构建期不可枚举（先返回空数组被导出器拒绝）。现改为 `/journal?edit=<id>` + `<Suspense>` 包裹的 `useSearchParams()`，`JournalScreen` 按参数决定渲染列表还是编辑器；列表项、保存跳转、首页入口与端到端用例同步更新，并新增「从列表点进编辑器 + 冷启动刷新后仍在同一篇」两步断言。代价：日志不再有 `/journal/<id>` 短链接（Web 侧同样如此，且本项目本就没有云端分享能力，可用路径是导出备份 JSON）。
- **Service Worker 缓存了 AI 状态接口**：配置好模型凭据后界面仍显示「未配置」，且测试的路由桩被绕过。SW 不再缓存 `/api/*`。
- **报告页性能**：原本逐日调用 `getProgress` 共 121 次，改为 `listProgress` 一次区间查询。
- **复习到期判定**：当日重学项的次日日期在未来时被误判为未到期，`isDueForReview` 已修正为允许当日重学优先。
- **排序题判分过严**：由「相邻题对全部正确」改为 Kendall 一致性比例配合题目级容差，避免一个位置差异就判错。
- **Dexie 索引缺失导致 `SchemaError`**：为 `attempts`、`knowledgeStates`、`reviewStates`、`journals`、`plans`、`progress`、`exerciseIssues`、`aiAnalyses`、`aiUsage` 补上单列 `profileId` 索引。
- **新手引导完成后不跳转**：最后一步改为显式 `router.push('/train')`。

### 已知限制

- 未部署到任何环境：`docs/DEPLOYMENT.md` 的步骤是说明而非验证结果。
- APK 未在真机或模拟器上运行过：构建成功、包内资源逐路径核对、那份资源经 Playwright 15 项验证，构建机上 `adb devices` 为空，所以没有自动化真机测试；返回键、闪屏、通知权限弹窗、存储配额这些原生行为仍无证据。且是 debug 签名，不能上架；Release/AAB 步骤未执行。
- APK 内 AI 教练不可用（纯离线包不含服务端）；PWA 与 APK 的存储是两个不同域，训练记录不互通，只能靠导出/导入 JSON 搬运。
- 云端账户与同步（Phase 3）未接入应用，仅有 `DataStore` 接缝与 SQL 迁移。
- PWA 无法保证后台唤醒，提醒只在应用打开时生效；未实现服务端推送（无 `PushSubscription`），APK 也未引入原生本地通知插件。
- 限流是单进程内存实现，多实例部署需要换成共享存储。
- `components/reminder-gate.tsx` 的接线本身没有自动化测试（决策函数有 15 个单元测试），需要真机验证横幅与系统通知的实际表现。
- SSRF 校验存在 DNS 重绑定（TOCTOU）残余风险，详见 `SECURITY.md` 第 3 节。
- 本地数据与备份文件均为明文，未做静态加密。
- 题库难度值是编辑判断，未经样本化标定。
- 未配置 CSP 头与依赖扫描自动化。
