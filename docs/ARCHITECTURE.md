# 架构说明

本文档说明 LogicDaily 的分层方式、数据流与几个关键设计决策的理由。读之前不需要了解项目。

## 1. 一句话架构

**本地优先的确定性领域层 + 客户端渲染的移动 Web 外壳 + 可选的服务端 AI 代理。**

```
┌──────────────────────── 浏览器（唯一的数据主副本）────────────────────────┐
│  app/ (App Router 页面)  →  features/*/ 视图  →  components/ 通用控件      │
│                                   │                                        │
│                                   ▼                                        │
│                      app/providers.tsx（上下文：store / settings / dateKey）│
│                                   │                                        │
│                 ┌─────────────────┴──────────────────┐                     │
│                 ▼                                    ▼                     │
│        lib/domain/*（纯函数）                 lib/db/store.ts               │
│        判分·归因·调度·掌握度·计划·统计          DataStore 接口 → LocalStore   │
│                                                        │                   │
│                                                        ▼                   │
│                                                 Dexie → IndexedDB          │
└────────────────────────────────────────────────────────────────────────────┘
                                   │  仅 AI 请求（可选）
                                   ▼
┌──────────────────────── 服务端（无状态代理）───────────────────────────────┐
│  app/api/ai/analyze/route.ts → lib/ai/service.ts → lib/ai/provider.ts      │
│    同源校验 · Zod 请求校验 · 限流            SSRF 检查 · 超时/重试 · 输出校验 │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼   OpenAI 兼容接口（Key 只在这一层使用）
```

## 2. 分层规则

| 层     | 位置                               | 允许依赖                    | 不允许                                                     |
| ------ | ---------------------------------- | --------------------------- | ---------------------------------------------------------- |
| 领域层 | `lib/domain/`                      | 只依赖自身与 `zod`          | React、Dexie、`fetch`、`window`、`Date.now()` 之外的副作用 |
| 数据层 | `lib/db/`                          | 领域层的类型                | React、UI                                                  |
| 用例层 | `lib/services/`                    | 领域层 + 数据层接口         | React                                                      |
| 视图层 | `features/`、`components/`、`app/` | 用例层 + 领域层（只读函数） | 直接读写 IndexedDB                                         |
| AI 层  | `lib/ai/`                          | 领域层类型                  | 被视图层直接 `fetch`（必须走 `/api/ai/*`）                 |

领域层是纯函数这件事带来三个直接好处：判分/调度/计划可以脱离浏览器单元测试；同样的输入必然得到同样的输出，UI 的「为什么排到今天」永远能复现；将来换存储或换框架时领域层不动。

时间也是注入的：领域函数接受 `todayKey` / `nowTs` 参数，由 `providers.tsx` 统一提供，所以「跨午夜」「时区」「测试里假装是 2026-03-17」都不需要 mock 时钟。

## 3. 为什么本地优先

- 这类应用记录的是用户真实的犹豫与错误判断，敏感度远高于普通习惯打卡。默认不出设备是最省心的答案。
- 离线可用让「手机上每天 5 分钟」成立：地铁里、没网也能练。
- 少一个后端就少一整套账户、备份、可用性负担。

代价是「换设备/换浏览器」需要手动导出导入。因此备份格式是**带版本与结构校验的 JSON**，导入时按 `updatedAt` / `generatedAt` 新者胜、重复项跳过，并且会剥离设置里的 `apiKey` / `key` / `token` 字段——备份文件不该携带凭据。

## 4. 数据主副本与 DataStore 接缝

`lib/db/store.ts` 定义 `DataStore` 接口（约 40 个方法），`LocalStore` 是它唯一的实现。用例层只接受 `DataStore`，不认识 Dexie。

云端模式（Phase 3）的设想是新增 `CloudStore implements DataStore`，按 `syncState.localRevision` 做增量上行、按行级 `updatedAt` 做冲突判定，UI 不需要改。目前 `syncState` 表已经在记录 `localRevision` 与 `pendingOps`（每次写入 `bumpRevision`），但没有任何东西消费它——这是有意的：先把「变更可被编号」这件事做实，再决定同步策略，而不是先写一个没人用的同步器。

`supabase/migrations/` 里的表结构与 RLS 策略对应这份接口，但应用尚未连接它。

## 5. 存储布局（Dexie）

13 个对象仓库，全部按 `profileId` 隔离（访客的 profileId 是字面量 `'local'`）。要点：

- 复合键 `[profileId+dateKey]`、`[profileId+exerciseId]` 支撑两类高频查询：某一天的记录、某道题的历史。
- **Dexie 的 `between()` 默认左闭右开**。所有日期区间查询都显式传 `true, true`，否则「今天」的记录会被整段丢掉（这个 bug 曾经真实存在，表现为报告页永远显示「还没有作答记录」，被端到端测试抓到，`tests/integration/local-store.test.ts` 里有回归用例）。
- 题库表带 `seededFrom` 内容标签；播种按「题目 id + version」比对，内容包变化时增量更新，被移除的题会删掉但不会牵连作答记录（记录里存 `exerciseVersion`）。

字段级说明见 [DATA_MODEL.md](DATA_MODEL.md)。

## 6. 关键流程

### 提交一次作答

```
TrainingView 提交
  → services/training.submitAttempt(store, input)
      1. store.getExercise(id)                 取完整题目（含判分配置）
      2. gradeExercise(exercise, answer)        领域纯函数判分，产出 outcome/score/errorTypes/rationale
      3. store.listAttempts(近 30 天)           取历史错误计数
      4. classifyMistake(...)                   显式优先级归因（能力/知识/粗心/读错/题目歧义）
      5. store.addAttempt(...)                  写入作答记录
      6. scheduleNext(...)                      LD-SRS 计算复习点，写 reviewStates
      7. updateKnowledgeState(...)              EWMA 更新每个知识点掌握度
      8. markPlanItemDone(...)                  更新今日进度（仅计划内条目）
      9. 若标记题目歧义 → reportIssue(...)      进入题库复核清单
  → 界面展示解析、归因、以及「下次复习是什么时候、为什么」
```

第 2 步与第 4 步是纯函数，第 6/7 步也是。整条链路里只有 store 调用有副作用，所以「判分口径」在单元测试里是完全确定的。

### 生成今日计划

`generateDailyPlan(ctx)`（`lib/domain/daily-plan.ts`）按固定优先级装配：

1. 当天到期的「当日重学」项；
2. 到期的错题复习（按逾期天数与优先级排序）；
3. 到期的日志复盘；
4. 新题：用 `weaknessScore`、难度匹配度、题型多样性、近期错误标签做加权打分，用 `makeRng(dateKey + profileId)` 做**带种子**的随机抽取；
5. 一篇新的思考日志。

预算（`dailyBudgetMinutes`）用尽即截断。因为随机数是带种子的，同一天刷新不会换题，重跑测试也能复现。

### AI 分析一次

见 [AI_INTEGRATION.md](AI_INTEGRATION.md)。

## 7. 判分与错误归因

- 6 种作答形式共用一个 `gradeExercise` 入口，按 `answer.format` 收窄类型。
- 简答题按**检查点关键词覆盖率**计分，必填检查点缺失会限制最高分；`modelAnswer` 里必须出现这些关键词（`content:validate` 脚本会检查）。
- 排序题用 Kendall 一致性比例（所有题对里顺序正确的比例），容差来自题目 `grading.orderTolerance`。
- 开放题走自评量表，`outcome` 为 `self-assessed`，**不进入**正确率与平均得分的分子分母，避免「自己给自己打分」污染统计。
- 归因优先级（`lib/domain/mistake.ts`）：题目歧义标记 → 读错题 → 知识缺口（出现未认识的术语标签）→ 粗心（用时极短且信心高）→ 推理方式问题。每条都有可展示的 `rationale`。

## 8. 调度与掌握度

- **LD-SRS**：SM-2 派生。首次正确间隔随难度缩放，答错进入当日重学（`sameDayRelearn`，30 分钟后），间隔上限 45 天，连续 lapse 打 `leech` 标记。`describeSchedule()` 用人话解释结果，复习页直接展示。
- **掌握度**：每个知识点一条 EWMA（指数加权移动平均），置信度与难度参与权重；`weaknessScore = (1 - mastery) × confidence`，`rankedWeakPoints` 要求最少作答次数才参与排序，避免 1 次作答就断定薄弱。

## 9. 统计口径

`lib/domain/stats.ts` 里每个指标返回同一个形状：`{value, display, formula, note?, insufficientData}`。规则：

- 样本不足时 `display` 显示「暂无数据 / 样本不足」，而不是显示一个看起来像结论的 0%。
- `formula` 是给人看的中文口径说明，UI 里以「怎么算」折叠展示。
- 阈值集中在文件顶部（`MIN_SAMPLE_FOR_TREND = 12`、`MIN_SAMPLE_FOR_COMPARISON = 6`），报告页据此拒绝生成建议。
- 复习效果只比较**同一道题**的首次与复习作答配对样本。

## 10. 前端与 PWA

- 页面全部是客户端组件（数据在浏览器里，服务端没有可渲染的状态）。`app/layout.tsx` 里放了一段内联脚本在首帧前设置 `data-theme`，避免深浅色闪烁。
- 主题用 `data-theme` 属性 + CSS 变量（`@theme inline`），不用 `dark:` 变体，切换只需改一个属性。
- 底部导航与日志页都用了 `usePathname()` / `useSearchParams()`，因此各自被 `<Suspense>` 包住——否则 Next 16 的 `cacheComponents` 无法静态预渲染这些组件。
- Service Worker（`public/sw.js`）手写：页面外壳 stale-while-revalidate、静态资源 cache-first、**`/api/*` 永不缓存**。最后这条是修过的 bug：曾经 `/api/ai/status` 被缓存，导致配置好 Key 之后界面仍显示未配置。
- 更新策略：新 SW 不自动接管，提示用户点击重载，避免作答中途页面被刷掉。
- 图标由 `scripts/generate-icons.mjs` 用纯 Node（zlib + 手写 CRC32）生成 PNG，不引入任何图像处理依赖。

## 11. 两种构建目标（Web 与 APK）

同一套源码产出两种产物，差异全部收敛在构建期：

|          | Web（默认）                  | APK（Capacitor）                                                                                            |
| -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 命令     | `npm run build`              | `npm run build:apk-web` → `npx cap sync android` → `gradlew assembleDebug`                                  |
| 配置     | `cacheComponents` + 部分预取 | `output: 'export'`，由 `next.config.ts` 按 `BUILD_TARGET=capacitor` 切换（导出时由构建脚本在 `env` 里传入） |
| 服务端   | 有：`/api/ai/*` 代理模型调用 | **无**：静态包没有 Node 运行时                                                                              |
| AI 教练  | 配置密钥后可用               | 不可用，界面显示「AI 教练未启用」                                                                           |
| 其余功能 | 完整                         | 完整（题库、答题、归因、日志、复习、报告、备份）                                                            |

为什么需要 `.apk-src` 副本：`output: 'export'` 要求路由声明 `force-static`，而 `cacheComponents` 拒绝任何 `dynamic` 段配置——同一份 `app/api/**/route.ts` 无法同时满足两者。`scripts/build-apk-web.mjs` 因此把源码复制到构建目录，**在副本中**排除 `app/api` 与 `app/manifest.ts`（后者改为把 `content/app-manifest.json` 落成静态文件），再执行导出。仓库本体不被改动，`.apk-src/` 与 `apk-web/` 都是可再生产物。

一个连带的设计变更：日志详情原先是 `/journal/<id>` 动态段，但日志 id 属于本机数据、构建期不可枚举，静态导出因此无法工作（`generateStaticParams()` 返回空数组会被拒绝）。现在改为 `/journal?edit=<id>`——查询参数变化不需要新的路由载荷，静态外壳与站内跳转都成立，Web 与 APK 用同一套代码。

## 12. 测试策略

| 层         | 手段                                                | 覆盖                                                                                                                                                                                                                                |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 领域纯函数 | Vitest（`tests/unit/`）                             | 判分 6 形式、归因优先级、SRS 边界、掌握度、计划确定性、统计口径、提醒决策、SSRF、限流                                                                                                                                               |
| 数据层     | Vitest + fake-indexeddb（`tests/integration/`）     | 播种与再播种、区间查询含端点、备份导出导入与拒绝非法结构、profile 隔离                                                                                                                                                              |
| 题库内容   | `scripts/validate-exercises.mjs` + 内容自检测试     | id 规范、枚举合法、正确项不得携带错误类型标签、陷阱项必须被解析解释、排序答案必须是全排列、重复题干检测                                                                                                                             |
| 端到端     | Playwright，Pixel 7 视口                            | 引导、答题到解析、错因与题目歧义、复习说明、刷新后数据仍在、日志增删改查与八步向导、报告指标、导出→清除→导入、非法导入被拒、AI 三种降级、横向溢出与键盘遮挡                                                                         |
| APK 资源   | Playwright + 静态服务器（`npm run verify:apk-web`） | 打进包内的那份 `apk-web/`：112 题随包播种、题目深链接、提交判分、AI 降级为「未启用」、`/journal?edit=` 全流程含冷启动刷新、5 条路由无横向溢出。**测的是资源目录，不是安装后的 App**（APK 未在真机运行过，见 `docs/ANDROID.md` 4.5） |

端到端测试固定使用 `?exercise=ex-cond-001` 深链接，避免「今日计划」随日期变化导致不稳定。

## 13. 明确的非目标

- 不做通用笔记/待办工具；日志字段是固定的思考结构，不是自由编辑器。
- 不做能力测评与证书；没有依据支持「逻辑能力提升 X%」这种输出。
- 不做社交、排行、内容 UGC（题库是编辑维护的，见 `CONTRIBUTING.md`）。
- 不在判分链路里调用大模型：判分必须确定、可测、离线可用。
