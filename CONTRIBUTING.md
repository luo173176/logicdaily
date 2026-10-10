# 参与开发

感谢你想改进 LogicDaily。开始之前请先读 [SECURITY.md](SECURITY.md)（安全问题走私报，不要开 PR）与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 环境要求

- Node.js 20 或 22（CI 用 22；本地开发实测 22.x）
- npm（仓库锁文件是 `package-lock.json`）
- 一个现代浏览器（需要 IndexedDB 与 `Intl` 时区支持）
- 跑端到端测试时需要下载 Playwright 浏览器：`npx playwright install`

不需要数据库、不需要账号、不需要任何 API Key 就能开发全部核心功能。

## 起步

```bash
git clone <你的 fork>
cd logicdaily
npm ci
npm run dev          # http://localhost:3000
```

提交前请全部跑一遍：

```bash
npm run typecheck
npm run lint
npm run content:validate
npm run test
npm run build
npm run test:e2e     # 会自己起停生产服务器，注意别占用 3000/3123 端口
```

`npm run lint` 允许 warning 但要求 0 error（CI 用 `--max-warnings=20`）。目前保留的 warning 是 `react-hooks/set-state-in-effect`：这个规则无法区分「effect 里调用异步加载函数」和「渲染期级联 setState」，本项目的页面数据加载属于前者，理由写在 `eslint.config.mjs` 的注释里。真正的同步反例已经改成 `useState` 惰性初始化了，新增代码不要再引入同步 setState。

## 代码风格

- TypeScript `strict`，不用 `any`（确实无法避免时用 `unknown` + 收窄）。
- 领域层（`lib/domain/`）**必须是纯函数**：不接受 `window`、不 `fetch`、不读 `Date.now()`——当前日期与时间戳由调用方作为参数传入。这样判分、调度、计划才谈得上可测试与可复现。
- 时间统一用 `DateKey`（`'YYYY-MM-DD'` 字符串）做算术，基准是 UTC 正午，避开夏令时与跨时区抖动。需要新时间函数时改 `lib/domain/time.ts`，不要在业务里手写 `new Date()` 拼接。
- 每个 schema 都是 Zod 定义，运行时校验一次，类型由 `z.infer` 推导，不重复手写 interface。
- 注释只写「为什么」，不写「这行做什么」。项目里已有的注释基本都是踩过的坑（例如 Dexie `between()` 默认右开、SW 不能缓存 `/api/*`）。
- 注释、文案、提交信息用简体中文；代码标识符用英文。
- 面向用户的文案要具体、不夸大：不要写「提升你的逻辑能力」，要写「今天的一道题和一篇日志还没写」。
- 格式化：`npm run format`（Prettier），不要手改格式化的空白差异。

## 目录职责

| 位置                 | 放什么                                                                          |
| -------------------- | ------------------------------------------------------------------------------- |
| `lib/domain/`        | 纯函数领域逻辑与 schema。新增业务规则先想能不能放这里                           |
| `lib/db/`            | Dexie 表结构与 `DataStore` 实现。改表要动 `database.ts` 的 version              |
| `lib/services/`      | 用例编排（提交作答、生成计划、提醒决策）。这里是唯一同时碰领域层和数据层的地方  |
| `lib/ai/`            | 模型适配层。新增任务看 [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) 第 7 节 |
| `features/<域>/`     | 视图与交互逻辑，按业务域切分，不放数据访问                                      |
| `components/`        | 跨域复用的通用控件                                                              |
| `app/`               | 路由外壳，尽量薄；页面组件基本只是 `import` 对应 feature                        |
| `content/exercises/` | 题库 JSON，一题型一个文件                                                       |
| `scripts/`           | 构建期/开发期脚本，不参与运行时                                                 |

## 怎么加一道题

题库是**内容即代码**：每道题都要通过机器校验。

1. 找到对应文件 `content/exercises/<category>.json`（结构：`{ schemaVersion, category, exercises: [...] }`）。
2. 写一道题。必填字段：`id`、`version`、`category`、`knowledgePoints`、`difficulty`、`estimatedSeconds`、`format`、`stem`、`answer`、`explanation`、`provenance`、`status`、`grading`、`reviewTags`。
   - `id` 形如 `ex-<缩写>-<三位序号>`，全库唯一。
   - `category` 必须是 14 个题型之一；`knowledgePoints` 里的 id 必须存在于 `lib/domain/taxonomy.ts` 的 `KNOWLEDGE_POINTS`（新增知识点就在那里加）。
   - `errorType` 必须是 15 种逻辑错误之一。
   - 六种 `format` 的专属约束：
     - `single-choice` / `true-false`：`answer.keys` 指向唯一正确项。
     - `multi-choice`：漏选/错选分别计入 `missedKeys` / `wrongKeys`，`grading.partialCredit` 决定是否给部分分。
     - `short-answer`：`explanation.checkpoints` 里每个检查点给 `keywords` 与 `weight`，**这些关键词必须出现在 `modelAnswer` 文本里**，否则判分永远命中不了。
     - `ordering`：`answer.order` 必须是选项 key 的一个全排列。
     - `open-response`：走自评量表，`outcome` 为 `self-assessed`，不进正确率与平均得分。
   - **正确选项上不得挂 `errorType`**；每个带 `errorType` 的干扰项必须在 `explanation.commonMistakes` 里有对应解释，且解释要说清「为什么这样做是错的」。
   - 有争议的题写进 `alternatives`（可接受的其他答案 + 理由），不要靠改答案掩盖争议。
   - `provenance` 说明来源。**只接受原创题或许可兼容的内容**，不要抄教辅、不要抄网络题库；AI 生成的草稿必须人工验算并改写后提交。
   - `status` 只有三个取值：`'draft'`（新题默认）、`'validated'`（已复核，现有 112 题全部是这个状态）、`'retired'`（下线但历史记录仍可解释）。第二人复核通过才从 `draft` 改成 `validated`。
3. 跑校验：
   ```bash
   npm run content:validate
   npm run test -- tests/integration/content.test.ts
   ```
   校验脚本会检查 id 规范、枚举合法性、正确项不带错误类型、干扰项必须被解释、简答关键词出现在参考答案里、排序是全排列、重复 id 与重复题干。它会打印覆盖情况（每个题型至少 8 题）与告警。
4. 如果引入了新知识点或新错误类型，同步更新 `lib/domain/taxonomy.ts` 与（如需要）`docs/DATA_MODEL.md`。

## 怎么改数据模型

1. 在 `lib/domain/` 改 schema 与记录类型。
2. `lib/db/database.ts` 里 `this.version(N)` **新增一个版本**（不要改历史版本的 stores 定义），把新索引写进去。Dexie 升级是增量的，老用户浏览器里已有数据。
3. 需要数据迁移时用 `.upgrade()` 回调，并在 `tests/integration/local-store.test.ts` 里加一条「老数据升级后仍可读」的用例。
4. 备份格式若变化，同步 `exportBackup` / `validateBackupPayload` 的版本号与校验，并保证**能导入旧版本备份**。
5. 若启用了云端模式，`supabase/migrations/` 加一个迁移文件，字段与 TS 类型对齐（snake_case ↔ camelCase 在映射层处理）。

## 测试要求

- 新增/修改领域逻辑：必须有单元测试，且要覆盖边界（空数组、样本不足、跨月、逾期、休息日）。
- 新增判分形式：`tests/unit/grading.test.ts` 里加用例，并在 `tests/unit/exercise-schema.test.ts` 里加 schema 用例。
- 新增数据层方法：`tests/integration/local-store.test.ts` 加用例。**日期区间查询必须断言两端都包含**（历史上这里出过 bug：Dexie `between()` 默认右开，导致报告页永远看不到今天的记录）。
- 新增用户流程：`tests/e2e/` 加移动端视口用例。端到端测试要用固定深链接（如 `/train?exercise=ex-cond-001`）而不是依赖「今日计划」，否则换一天就失败。
- 不要在测试里断言「应该有的行为」——先跑一遍看真实输出，再决定是实现要改还是期望要改。这个项目里几次测试失败都是先发现实现 bug。

## 提交与 PR

- 分支名 `feat/<短描述>` / `fix/<短描述>` / `content/<题型>`。
- 提交信息用祈使句中文或英文均可，第一行 ≤ 72 字符，正文说明**为什么**改。
- 一个 PR 做一件事。题库改动不要和功能改动混在同一个 PR 里（复核方式完全不同）。
- PR 描述里请写：改了哪些文件、跑了哪些命令与结果、哪些没来得及验证。
- UI 改动请附截图（`npx tsx scripts/capture-screenshots.mts` 可以重新生成文档截图，视口 412×915），并确认在手机视口下没有横向滚动、输入框不被底部导航挡住（端到端里已有这两项检查，视口取 `devices['Pixel 7']`，实测 412×839）。

## 改到 APK 相关的东西

项目有两个构建目标：Web（默认，含 `/api/ai/*` 服务端路由）与 APK（纯离线，无服务端）。`next.config.ts` 用 `BUILD_TARGET=capacitor` 切换，因为 `output: 'export'` 与 `cacheComponents` 互斥，而 Next 16 的 `next build` 没有 `-c` 参数可以指定第二份配置。

```bash
npm run build:apk-web    # 复制源码到 .apk-src/ → 静态导出 → apk-web/
npm run verify:apk-web   # 用 Playwright 验证打进包内的那份资源（14 项）
npm run apk:sync         # build:apk-web + cap sync android
cd android && ./gradlew clean assembleDebug
```

需要知道的前提与禁忌：

- **不要在仓库里删除或改动 `app/api`** 来「让导出通过」。那是 SSRF 防护、密钥只留服务端、限流所在地；构建脚本的做法是把源码复制进 `.apk-src/`，**只在副本里**排除服务端路由。
- 静态导出不支持：依赖 `Request` 的 Route Handler、无 `generateStaticParams()` 的动态段、`useSearchParams()` outside `<Suspense>`、元数据路由（`app/manifest.ts`）。这就是日志用 `/journal?edit=<id>`、manifest 数据放 `content/app-manifest.json` 的原因 —— 改这两处会同时影响 Web 与 APK。
- `android/local.properties` 里的 `sdk.dir` **必须用正斜杠**（`sdk.dir=D:/dev/android-sdk`）。反斜杠转义会让 Gradle 在 `SdkLocator` 校验路径时抛 `java.io.IOException`。这个文件不提交。
- Capacitor 版本要与本机 JDK 匹配：8.x 生成的工程要求 JDK 21 + compileSdk 36；本仓库现在钉在 6.2.2（Java 17 / compileSdk 34）。升级要连 `android/` 工程一起重新生成并真机验证。
- 产物 `*.apk`、`apk-web/`、`.apk-src/`、`android/app/src/main/assets/public` 都在 `.gitignore` 里：APK 走 GitHub Release，不进工作树。
- **要发布的包必须从 `clean` 构建**。AGP 的增量打包在条目变小时不回收旧位置，实测同一份代码的增量包比干净包多 430 KB 死空间。判断两个包是否等价要比条目清单与逐条目大小，不要比文件总大小（Next 的构建 id 参与 chunk 文件名，字节数每次都会浮动）。
- 影响用户可见行为的改动，`npm run test:e2e` 与 `npm run verify:apk-web` 都要跑；后者会告诉你包内那份资源是否还自洽。

## 加一个 AI 任务

见 [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) 第 7 节。要点：输出必须有 Zod 契约、提示词必须有版本号、任何用户私人内容的发送都必须有显式确认并更新 [docs/PRIVACY.md](docs/PRIVACY.md) 的数据流表。

## 文档

行为变化要同步文档，尤其是：`README.md` 的功能与「已知限制」清单、`docs/DATA_MODEL.md`（字段）、`docs/PRIVACY.md`（数据是否离开设备）、`CHANGELOG.md`。

这个项目的一个原则是**不夸大**：如果某个能力受限（PWA 后台提醒、APK 未真机验证、APK 内没有 AI、云端同步未实现），文档和界面都要如实写明。修好了再删掉那句限制说明。

## 许可

提交即同意你的贡献以 AGPL-3.0-or-later 授权（与仓库一致），包括你新增的题库内容。
