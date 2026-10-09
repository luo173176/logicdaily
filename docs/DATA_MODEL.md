# LogicDaily 数据模型

本文件是本仓库数据层的权威参考：每个 Dexie store 的主键与索引、每条记录的字段含义与写入者、备份文件的信封格式，以及版本/迁移与隔离规则。改动 schema 前请先读第 7、8、11 节。事实来源只有代码，文中 `file:line` 以当前工作树为准。

## 1. 本地优先：为什么 IndexedDB 是唯一真相来源

- 所有训练数据写在浏览器 IndexedDB 的 `logicdaily` 库里（`lib/db/database.ts:40`）。服务端只在 AI 调用时短暂存在，不保存任何用户数据：`app/api/ai/analyze/route.ts` 没有数据库连接，处理完即返回。
- 业务代码不直接调用 Dexie，一律通过 `DataStore` 接口（`lib/db/store.ts:63`）。当前唯一实现是 `LocalStore`，`mode` 恒为 `'local'`（`lib/db/store.ts:115-121`）；云端实现替换同一接口即可，这是 Phase 3 预留的接缝。对应的云端表结构已经写好在 `supabase/migrations/`（13 张表 + `owner_id` 行级隔离策略 + 题库种子），但**没有任何应用代码引用它**，它也不在 CI 的自动化路径里。
- 领域层（`lib/domain/*.ts`）是纯函数：不读系统时间、不读库，`dateKey` 与 `nowTs` 由调用方注入（`lib/domain/daily-plan.ts:38-49`）。因此同一份输入在任何设备上得到同一结果，也才可被单元测试覆盖。
- 日期在库中只有一个存储形态：本地时区的 `YYYY-MM-DD` 字符串 `DateKey`（`lib/domain/time.ts:6`），加减比较都在 UTC 正午基准上做，避开夏令时漂移（`lib/domain/time.ts:43-55`）。毫秒时间戳只用于 `createdAt`/`updatedAt`。
- 启动顺序被固定：开库 → 读/写设置 → 播种题库 → 才置 `ready`，避免页面在空题库上生成"今日计划"（`app/providers.tsx:95-135`）。
- 只有两项状态刻意不进 IndexedDB，存在 `localStorage`：主题偏好 `logicdaily:theme`（`lib/ai/client.ts:130-141`）与当日提醒去重标记 `logicdaily:reminder-fired:<dateKey>`（`components/reminder-gate.tsx:10`）。它们不属于备份范围，清除本地数据也不会清掉它们。

## 2. Dexie store 总览

库名 `logicdaily`，`this.version(1)`（`lib/db/database.ts:43-57`）。`LOCAL_DB_VERSION = 1`（`lib/db/database.ts:19`）只是给人看的常量，`version()` 里写的是字面量 `1`，改 schema 时两处都要动。

| store | 主键 | 索引 | 存什么 |
| --- | --- | --- | --- |
| `meta` | `key` | 无 | `MetaRecord = { key, value, updatedAt }`（`lib/domain/records.ts:125-129`）：预留键值槽位，**无读写实现**，只有 `clearLocalData` 防御性删 `onboarded:<profileId>`（`lib/db/store.ts:543`）。不要用它绕开 `settings` 存配置 |
| `settings` | `profileId` | 无 | 每 profile 一份 `AppSettings` |
| `exercises` | `id` | `category`、`format`、`difficulty`、`status` | 播种进来的题库，行结构 `Exercise & { seededFrom }`（`lib/db/database.ts:23`） |
| `attempts` | `id` | `profileId`、`[profileId+dateKey]`、`[profileId+exerciseId]`、`exerciseId`、`dateKey`、`createdAt` | 每次作答的完整快照 |
| `knowledgeStates` | `[profileId+knowledgePointId]` | `profileId`、`knowledgePointId` | 知识点掌握度（EWMA），无 `id` 字段 |
| `reviewStates` | `[profileId+exerciseId]` | `profileId`、`exerciseId`、`dueDateKey` | LD-SRS 复习状态，无 `id` 字段 |
| `journals` | `id` | `profileId`、`[profileId+deleted]`、`[profileId+updatedAt]`、`createdAt`、`reviewDueDateKey` | 思考日志（软删除） |
| `plans` | `id` | `profileId`、`[profileId+dateKey]`、`dateKey` | 每日计划，id 为 `plan-<profileId>-<dateKey>` |
| `progress` | `[profileId+dateKey]` | `profileId`、`dateKey` | 当日完成/跳过，一天一行 |
| `exerciseIssues` | `id` | `profileId`、`exerciseId`、`status`、`createdAt` | 题库复核清单 |
| `aiAnalyses` | `id` | `profileId`、`[profileId+subjectKind]`、`subjectId`、`createdAt` | AI 结构化分析结果 |
| `aiUsage` | `id` | `profileId`、`[profileId+createdAt]`、`task`、`createdAt` | AI 用量与错误元数据（不含正文） |
| `syncState` | `profileId` | 无 | 本地修订号与同步游标，每 profile 一行 |

补充事实：`lib/db/database.ts:72-82` 的 `knowledgeStateKey`/`reviewStateKey`/`progressKey`（拼成 `p1::ex-cond-001`）**没有任何调用点**，实际读写复合键用数组形式（`lib/db/store.ts:203`、`218`、`266`），两种键形式不通用。`exercises.format`、`attempts.[profileId+exerciseId]`、`journals.[profileId+deleted]`、`journals.[profileId+updatedAt]`、`journals.reviewDueDateKey` 这些索引当前没有查询使用（`lib/db/store.ts:168-174`、`242-246`），属于为云端映射预留。

## 3. 记录字段参考

### 3.1 AttemptRecord（`lib/domain/records.ts:5-27`）

构造与落库：`submitAttempt()`（`lib/services/training.ts:68-90`）；`reviseSelfReport()` 用同一 `id` 覆盖写回（`lib/services/training.ts:365-372`）。`id` = `atp-<nowTs 的 base36>-<exerciseId>`，同毫秒同题会碰撞并覆盖。

| 字段 | 类型 | 含义 / 何时变化 |
| --- | --- | --- |
| `id` / `profileId` | `string` | 主键 / 所有者 |
| `exerciseId` / `exerciseVersion` | `string` / `number` | 题目 id / 作答时版本，题目更新后旧记录仍可解释 |
| `dateKey` | `string` | 归属日（本地时区），进度与统计按它聚合 |
| `createdAt` | `number` | 提交毫秒 |
| `answer` | `AnswerInput` | 原样保留的作答，按 `format` 区分的联合类型（`lib/domain/grading.ts:6-11`） |
| `outcome` | `GradeOutcome` | `'correct' \| 'partial' \| 'incorrect' \| 'self-assessed'`（`lib/domain/grading.ts:4`） |
| `score` | `number` | 0～1，来自判分，不被后续归因改写 |
| `timeSpentSeconds` | `number` | 界面计时，最小 1 秒（`features/training/training-view.tsx:327`） |
| `confidence` | `number` | 1～5 提交前自评信心 |
| `reasoning` | `string` | 用户自己写的推理过程，可为空串 |
| `selfReport` | `SelfReport` | `'careless' \| 'unknown-term' \| 'misread' \| 'ambiguous' \| null`（`lib/domain/mistake.ts:6`），看解析后可修正 |
| `errorTypes` | `LogicErrorType[]` | 归因后的错误类型，来自所选项的 `errorType` 标记或判分规则 |
| `cause` | `CauseType` | 错因类别；修正自评只改这里 |
| `planItemId` | `string \| null` | 对应今日计划项 id，用于把作答计入进度 |
| `isReview` | `boolean` | 是否复习作答，复习效果指标依赖它 |
| `flaggedForReview` | `boolean` | 用户认为题目有歧义；仅 `selfReport === 'ambiguous'` 时为真 |
| `aiAnalysisId` | `string \| null` | 预留关联字段，**当前恒为 `null`**（`lib/services/training.ts:87`），无回填代码 |

不变量：修正 `selfReport` 不改 `score`/`outcome`/复习调度，避免用户通过改口操纵间隔（`lib/services/training.ts:333-336`）。

### 3.2 DailyPlanRecord 与 DailyPlanItemRecord（`lib/domain/records.ts:29-51`）

由 `planToRecord()`（`lib/domain/daily-plan.ts:230-242`）产生，`ensureTodayPlan()` 落库（`lib/services/training.ts:248-250`）；同一天再次进入只读不重写，因此"为什么今天给我这些题"事后可解释。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | `string` | `plan-<profileId>-<dateKey>`，天然每天每 profile 一条 |
| `profileId` / `dateKey` | `string` | 所有者 / 归属日 |
| `budgetMinutes` | `number` | 本次时间预算；休息日降为 `max(3, round(budget×0.4))`（`lib/domain/daily-plan.ts:58-60`） |
| `restDay` | `boolean` | 当天是否为配置的休息日 |
| `items` | `DailyPlanItemRecord[]` | 计划项，`id` 为 `item-<序号>` |
| `notes` | `string[]` | 面向用户的选择理由，界面直接展示 |
| `generatedAt` | `number` | 生成时刻，也是导入时计划新旧判定键 |
| `algorithm` | `string` | 固定 `'logicdaily-daily-plan-v1'`（`lib/domain/daily-plan.ts:14`） |

计划项：`activity`（7 种活动类型之一）、`exerciseId`、`journalId`、`estimatedSeconds`、`reason`（一句话解释为什么出现）、`kind`（`'new' \| 'review' \| 'same-day-relearn' \| 'journal'`）、`required`（只有当天重学项为 `true`，`lib/domain/daily-plan.ts:87`）。注意 `savePlan()` 不调 `bumpRevision`（`lib/db/store.ts:248`）。

### 3.3 DailyProgressRecord（`lib/domain/records.ts:53-63`）

主键 `[profileId+dateKey]`。创建者 `ensureTodayPlan()`（`lib/services/training.ts:252-263`，带 `planId`），更新者 `markPlanItemDone()` / `markJournalItemDone()` / `skipPlanItem()`（`lib/services/training.ts:146-207`、`396-419`）。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `dateKey` / `profileId` | `string` | 复合主键两半 |
| `planId` | `string \| null` | 创建时关联的计划 id；后续更新只透传不重算 |
| `completedItemIds` / `skippedItemIds` | `string[]` | 已完成 / 已跳过项 id，写入时按 Set 去重（`lib/services/training.ts:165-169`） |
| `totalSeconds` / `attempts` | `number` | 累计用时 / 计入的作答次数。`markJournalItemDone` 不累加 `attempts`，`markPlanItemDone` 两者都加 |
| `updatedAt` | `number` | 每次写入刷新，是导入冲突判定键 |

### 3.4 ExerciseIssueReport（`lib/domain/records.ts:65-74`）

写入者只有两处，都来自歧义标记：提交时（`lib/services/training.ts:129-141`）与修正自评时（`lib/services/training.ts:374-391`，先查同题是否已有 `open` 项以免重复）。`id` = `issue-<nowTs base36>-<exerciseId>`。`exerciseId` / `profileId`（被举报题目 / 举报者）、`note`（固定文案，说明来自用户标记）、`dateKey` / `createdAt`（归属日 / 提交时刻）。

- `kind`：`'ambiguous' \| 'wrong-answer' \| 'typo' \| 'too-hard' \| 'duplicate' \| 'other'`；当前代码只写 `'ambiguous'`。
- `status`：`'open' \| 'acknowledged' \| 'fixed' \| 'rejected'`；**应用内无状态迁移代码**，写入即 `'open'`，只被 `listIssues('open')` 读（`features/me/me-view.tsx:34`）。`'rejected'` 另有一处含义：`countAIUsageToday` 用它过滤 `AIUsageRecord`（`lib/db/store.ts:307`）。

### 3.5 AIUsageRecord（`lib/domain/records.ts:76-93`）

写入者：`features/coach/coach-panel.tsx:132-150`（作答/日志教练）、`features/coach/material-view.tsx:80-96`（材料分析）。`saveAIUsage()` 不 `bumpRevision`（`lib/db/store.ts:300`）。`id` = `usage-<Date.now() base36>-<场景后缀>`。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `profileId` / `task` | `string` | 所有者 / 任务名（6 个任务，`lib/ai/output-schema.ts:84-91`） |
| `provider` / `model` / `promptVersion` | `string` | 设置里的供应商标签 / 服务端回传的实际模型名（回退 `settings.ai.model`）/ 提示词版本，未知时 `'unknown'` |
| `createdAt` | `number` | 用量按它 + 时区分日统计（`lib/db/store.ts:304-308`），本类型没有 `dateKey` |
| `latencyMs` / `inputChars` / `outputChars` | `number` | 性能与体量 |
| `promptTokens` / `completionTokens` | `number \| null` | 供应商不返回 usage 时为 `null` |
| `status` | 枚举 | `'ok' \| 'error' \| 'rejected' \| 'degraded'`；当前只写前两个 |
| `errorCode` / `errorMessage` | `string \| null` | 只存错误类别与可公开描述，**不存用户隐私正文** |

### 3.6 AIAnalysisRecord（`lib/domain/records.ts:95-111`）

写入者：`features/coach/coach-panel.tsx:152-166`（`subjectKind: 'journal'`）、`features/coach/material-view.tsx:97-112`（`'material'`）。`id` = `ana-<Date.now() base36>`，`profileId` 为所有者。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `subjectKind` / `subjectId` | 枚举 / `string \| null` | `'attempt' \| 'journal' \| 'material' \| 'profile'`，其中 `'attempt'`、`'profile'` **无写入路径**；`subjectId` 是对应日志 id，材料分析为 `null` |
| `task` / `provider` / `model` / `promptVersion` | `string` | 产生该结果所需的模型元数据 |
| `createdAt` | `number` | 生成时刻 |
| `result` | `unknown` | 已通过 zod 校验的结构化结果（`lib/ai/output-schema.ts:13-73`），界面按字段渲染 |
| `uncertainty` | `string` | 模型自己声明的不确定之处 |
| `retainedInputSummary` | `string \| null` | 是否保留输入全文摘要；**所有写入都是 `null`**，即不长期保存私人输入原文 |

### 3.7 SyncStateRecord（`lib/domain/records.ts:113-123`）

只有 `bumpRevision()`（`lib/db/store.ts:329-343`）与 `importBackup()`（`lib/db/store.ts:495-505`）写它。主键 `profileId`，一 profile 一行。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `localRevision` | `number` | 单调递增。写 `settings`/`attempts`/`knowledgeStates`/`reviewStates`/`journals`/`progress`/`aiAnalyses` 时 +1；`plans`/`exerciseIssues`/`aiUsage` 不自增 |
| `lastSyncedAt` / `lastSyncedRevision` | `number \| null` / `number` | 本地模式下恒为 `null` / `0` |
| `pendingOps` / `conflicts` | `number` | 每次 `bumpRevision` +1，导入后重置为 `0` / 导入时被较新数据覆盖的条目数（`merged`） |
| `mode` / `updatedAt` | `'local' \| 'cloud'` / `number` | 目前恒为 `'local'` / `Date.now()` |

界面在"我的 → 数据与隐私"展示 `mode` 与 `localRevision`（`features/me/me-view.tsx:357`）。

### 3.8 Journal 及子记录（`lib/domain/journal.ts`）

写入者：`store.upsertJournal()`（`lib/db/store.ts:232-235`），来源是日志编辑器与新建页（`features/journal/journal-views.tsx:165`、`447-448`）。整份文档由 `journalSchema` 校验后写入，缺省字段取默认值。

`journalEvidenceSchema`（`lib/domain/journal.ts:3-12`）：`id`、`journalId`、`stance`（`'support' \| 'oppose' \| 'alternative' \| 'unknown'`）、`text`（1～4000）、`source`（≤300，默认 `''`）、`reliability`（1～5 整数，默认 3）、`createdAt`。`journalStepAnswerSchema`（`lib/domain/journal.ts:14-18`）：`stepId`（≥1 字符，**不校验是否属于 8 个正式步骤 id**）、`text`（≤4000，默认 `''`）、`updatedAt`。

`journalSchema`（`lib/domain/journal.ts:20-49`）：

| 字段 | 限制 / 默认 | 说明 |
| --- | --- | --- |
| `id` / `profileId` | `min(1)` | 主键 / 所有者 |
| `title` | 1～120 | 必填；快速记录时缺省 `'未命名思考'`（`lib/domain/journal.ts:80`） |
| `problem` / `background` | ≤4000，默认 `''` | 问题描述、发生背景 |
| `facts` / `assumptions` / `conclusion` / `alternativeExplanations` / `keyUncertainties` / `verificationActions` / `reviewOutcome` | ≤6000，默认 `''` | 向导正文；`reviewOutcome` 是复盘后的实际结果 |
| `reviewDelta` | 枚举，默认 `'unknown'` | `'better' \| 'as-expected' \| 'worse' \| 'unknown'` |
| `steps` / `evidence` | 数组，默认 `[]` | 向导作答与证据清单 |
| `tags` | 每项 1～24，最多 12 个，默认 `[]` | 标签过滤 |
| `selfConfidence` | 1～5 整数，默认 3 | 写下结论时的信心，复盘时对比 |
| `status` | 默认 `'open'` | `'open' \| 'review-due' \| 'reviewed' \| 'decided' \| 'archived'` |
| `reviewDueDateKey` | `^\d{4}-\d{2}-\d{2}$` 或 `null` | 到期复盘日，会进入次日计划（`lib/services/training.ts:233-235`） |
| `createdAt` / `updatedAt` | 必填数字 | `updatedAt` 是导入冲突判定键 |
| `deleted` / `deletedAt` | `false` / `null` | 软删除标记，同步时需传播；`listJournals` 默认过滤（`lib/db/store.ts:244`） |
| `aiConsent` | 默认 `false` | 只有用户勾选后日志正文才会被送去 AI（`features/coach/coach-panel.tsx:95`） |

`journalCompleteness()` 只统计 8 个向导字段是否非空（`lib/domain/journal.ts:86-101`）；`searchJournals()` 把标题、8 字段、`reviewOutcome`、标签、步骤作答、证据拼成小写全文做多词 AND 匹配并排除 `deleted`（`lib/domain/journal.ts:103-131`）。

### 3.9 Exercise 与题库文件（`lib/domain/exercise-schema.ts`）

`exerciseSchema` 是对 `format` 的判别式联合（`lib/domain/exercise-schema.ts:147-154`），6 个分支共享 `baseFields`（`lib/domain/exercise-schema.ts:56-71`）：

| 字段 | 规则 |
| --- | --- |
| `id` | ≥3 字符，`^[a-z0-9][a-z0-9._-]*$`；内容目录额外要求 `^ex-[a-z-]+-\d{3}$`（`scripts/validate-exercises.mjs:75`） |
| `version` | 正整数，播种时用于判断是否覆盖 |
| `category` / `knowledgePoints` | 14 类枚举之一 / 1～4 个 `KNOWLEDGE_POINT_IDS` |
| `difficulty` / `estimatedSeconds` | 1～5 整数 / 20～600 整数 |
| `context` / `prompt` / `stem` | 可选 ≥4 / 可选 ≥4 / 必填 ≥6 |
| `explanation` | `summary`(≥8) + `steps`(每项≥6，≥1 条) + `commonMistakes`(默认 `[]`，每项含 `errorType` 与 `why`≥8，`option` 可选) + `takeaway`(≥6)，见 `lib/domain/exercise-schema.ts:41-54` |
| `reviewTags` / `provenance` | 1～6 项非空 / ≥4 字（题目来源或编写说明） |
| `status` | 默认 `'validated'`；`'draft'`、`'retired'` 不进计划与复习（`lib/services/training.ts:227`、`301`） |
| `grading` | `gradingConfigSchema`，默认 `{ partialCredit: true, orderTolerance: 0.2 }`，且 `.strict()`（`lib/domain/exercise-schema.ts:32-39`） |

分支差异（`lib/domain/exercise-schema.ts:73-145`）：

| `format` | options | answer | alternatives |
| --- | --- | --- | --- |
| `single-choice` | 2～6 项，`key` 大写字母且不重复 | `{ keys: 恰好 1 }` | 默认 `[]`，每项 `keys≥1` + `note≥4` |
| `multi-choice` | 3～8 项 | `{ keys: ≥1 }` | 同上 |
| `true-false` | 无 | `{ value: boolean }` | 有，判分未使用 |
| `short-answer` | 无 | `{ checkpoints(≥2), correctRatio(0.5～1, 默认 0.8), partialRatio(0.2～0.9, 默认 0.5), modelAnswer(≥8) }` | 有，判分未使用 |
| `open-response` | 无 | `{ scale(≥3 档，score 0～4), guidance(≥8), selfAssessed: 恒 true }` | 有，判分未使用 |
| `ordering` | `items` 3～6 项（按正确顺序给出，界面负责打乱） | `{ keys: ≥3 }` | 有，判分未使用 |

`optionSchema.errorType`（`lib/domain/exercise-schema.ts:16-22`）是题目预先标注的典型推理错误：正确选项不应带它，`reason`(≥4) 可选；用户选中带该标记的选项即命中错误（`lib/domain/grading.ts:34-39`）。`checkpointSchema`（`lib/domain/exercise-schema.ts:24-30`）含 `id`、`label`、`keywords`(≥1)、`weight`(1～5，默认 1)、`required`(默认 false)，简答判分按加权覆盖率与必要要点判定（`lib/domain/grading.ts:271-331`）。

文件层 `exerciseFileSchema`（`lib/domain/exercise-schema.ts:162-166`）：`{ schemaVersion: ≥1, category: 14 类之一, exercises: ≥1 }`，`schemaVersion` 被校验脚本硬性要求为 1（`scripts/validate-exercises.mjs:203`）。`EXERCISE_CONTENT_VERSION = 1`（`lib/domain/exercise-schema.ts:170`）目前只被测试引用。入库行是 `ExerciseRow = Exercise & { seededFrom: string }`（`lib/db/database.ts:23`）；`seededFrom` 是纯本地字段，读出时被剥掉（`lib/db/store.ts:565-569`），不进备份也不进界面。

### 3.10 AppSettings（`lib/domain/settings.ts:39-81`）

`settingsSchema` 顶层 `.strict()`（未知键即解析失败）；嵌套 `ai`、`reminders` 非 strict，未知键被 zod 剥离。每个 profile 一行，主键就是 `profileId`。

| 分组 | 字段 | 规则（默认值） |
| --- | --- | --- |
| 身份 | `profileId` / `displayName` / `onboarded` | 必填非空 / ≤40（`'我'`） / boolean（`false`） |
| 训练 | `dailyBudgetMinutes` | 3～60 整数（`10`） |
| | `newToReviewRatio` | 0～1（`0.4`），新题占比 |
| | `preferredCategories` | 14 类子集（`[]` = 不限） |
| | `restWeekdays` | 0～6 整数数组（`[]`），0=周日；休息日只减轻任务，不清零连续天数 |
| | `difficultyBias` / `timezone` | 0～1（`0.5`） / 非空字符串（`'UTC'`，首次启动写设备时区，`app/providers.tsx:104-107`） |
| 日志/提醒 | `journalDailyReminder` | boolean（`true`），控制计划里是否总留一篇日志入口（`lib/domain/daily-plan.ts:193`） |
| | `reminders.enabled` / `.paused` | boolean（`false` / `false`） |
| | `reminders.time` / `.quietStart` / `.quietEnd` | 必须匹配 `TIME_RE`（`'20:00'` / `'22:30'` / `'07:30'`） |
| | `reminders.weeklyReviewDay` | 0～6（`0`） |
| 外观 | `theme` | `'system' \| 'light' \| 'dark'`（`'system'`） |
| AI | `ai.enabled` | boolean（`false`），默认关闭 |
| | `ai.provider` | 8 个预设标签之一（`'openai-compatible'`，`lib/domain/settings.ts:5-14`） |
| | `ai.model` / `ai.baseUrlLabel` | ≤80（`''`，留空用服务端默认模型） / ≤120（`''`）**仅展示用标签；API Key 永不进入客户端设置**（`lib/domain/settings.ts:72-73`） |
| | `ai.temperature` / `ai.timeoutMs` / `ai.maxOutputTokens` / `ai.dailyCallLimit` | 0～2（`0.4`）/ 3000～120000（`25000`）/ 128～4000（`900`）/ 0～200（`20`） |

`TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/`（`lib/domain/settings.ts:36`）：拒绝 `24:00` 与单位数小时，错误文案"时间格式必须是 HH:MM"。`defaultSettings(profileId)` 就是 `settingsSchema.parse({ profileId })`（`lib/domain/settings.ts:85-87`）。

### 3.11 ReviewState（`lib/domain/scheduling.ts:22-39`）

主键 `[profileId+exerciseId]`（`exerciseId` 是主键一半，行上没有 `id`），写入者 `submitAttempt()`（`lib/services/training.ts:92-105`）。`SRS_LIMITS`（`lib/domain/scheduling.ts:12-20`）：间隔 1～45 天、ease 1.8～2.8（默认 2.5）、同日重学延迟 30 分钟、连错 3 次标 `leech`。

| 字段 | 含义 |
| --- | --- |
| `ease` | 间隔系数；`q≥3` 增益 `0.1-(5-q)×(0.08+(5-q)×0.02)`，`q<3` 时 `-0.2` |
| `intervalDays` | 当前间隔：`repetitions=1` 固定 1 天，`=2` 为 `round(3×难度系数×2)/2`，其后 `round(间隔×ease×难度系数)`，最终夹到 1～45 |
| `repetitions` / `lapses` | 连续成功次数 / 遗忘次数；答错时 `repetitions` 归 0 |
| `dueDateKey` | 下次到期日，`null` 表示不在队列 |
| `sameDayRelearn` / `sameDayRelearnAfterTs` | 答错当天约 30 分钟后再练一次 |
| `leech` | `lapses ≥ 3`，建议先读解析再做同类题 |
| `lastOutcome` / `lastConfidence` / `lastErrorTypes` | 最近一次表现；`scheduleNext` 透传旧 `lastErrorTypes`，由服务层在返回后覆盖为本次归因（`lib/services/training.ts:104`） |
| `updatedAt` | 导入冲突判定键 |

难度系数 `clamp(1-(difficulty-3)×0.08, 0.7, 1.3)`（`lib/domain/scheduling.ts:95-97`）：越难间隔越短。质量分 `q`（`lib/domain/scheduling.ts:54-89`）：答对 4、部分正确 3、答错 1、开放题 `score+1`；答对且信心≥4 且用时/预估≤1.2 加 1；信心≤2 减 1；夹在 0～5。

### 3.12 KnowledgeState（`lib/domain/mastery.ts:11-23`）

主键 `[profileId+knowledgePointId]`，写入者 `submitAttempt()` 对题目每个知识点各写一行（`lib/services/training.ts:107-122`）。更新公式（`lib/domain/mastery.ts:71-99`）：

```text
ewma' = clamp(ewma + 0.3 × 难度权重 × 信心信号 × (表现值 − ewma), 0, 1)
信心信号 = 0.55 + 0.09 × clamp(confidence, 1, 5)      // 0.64 ~ 1.00
难度权重 = clamp(0.7 + 0.1 × difficulty, 0.8, 1.2)
表现值   = 答对 1 / 部分正确 0.55 / 答错 0 / 开放题 0.25 + score × 0.1875
```

其余字段：`attempts`、`correct`、`partial`、`incorrect` 单调累加；`recentErrorTypes` 去重后保留最近 5 个；`lastAttemptDateKey`、`updatedAt`。派生规则：`MASTERY_MIN_ATTEMPTS = 3` 之前不出百分比（`lib/domain/mastery.ts:101-104`）；分档阈值 40/65/85（`lib/domain/mastery.ts:106-116`）；`weaknessScore = (1 − ewma) × min(attempts/8, 1.5)`，样本不足记 0（`lib/domain/mastery.ts:118-121`）；`knowledgeEvidence()` 用 3/8 次划分 `insufficient`/`developing`/`established`（`lib/domain/mastery.ts:65-69`）。

## 4. 判分与归因产生的取值

`GradeResult`（`lib/domain/grading.ts:13-30`）不落库，进入 `AttemptRecord` 的只有 `outcome`、`score`、`errorTypes`。要点：多选漏选记 `partial`、错选直接 `incorrect`（`lib/domain/grading.ts:137-164`）；排序按两两先后关系比例计分，`ratio ≥ 1 − orderTolerance` 记 `partial`（`lib/domain/grading.ts:240-268`）；简答是关键词覆盖检查，只作为漏点提示而非最终评分（`lib/domain/grading.ts:327-330`）；开放题恒为 `self-assessed`。`MistakeClassification`（`lib/domain/mistake.ts:20-28`）决定 `cause`、`errorTypes`、`flagForReview`，优先级链：用户自报 > 未作答 > 过快且未命中陷阱 > 命中陷阱选项 > 低信心 > 部分正确 > 兜底 `unknown`（`lib/domain/mistake.ts:38-164`）。

## 5. 受控词表（`lib/domain/taxonomy.ts`）

| 词表 | 数量 | 位置 | 用在 |
| --- | --- | --- | --- |
| `EXERCISE_CATEGORIES` | 14 | `taxonomy.ts:1-16` | `Exercise.category`、`settings.preferredCategories`、`exerciseFileSchema.category` |
| `LOGIC_ERROR_TYPES` | 15 | `taxonomy.ts:54-70` | `option.errorType`、`explanation.commonMistakes[].errorType`、`AttemptRecord.errorTypes`、AI 输出 `issues[].errorType` |
| `CAUSE_TYPES` | 7 | `taxonomy.ts:112-120` | `AttemptRecord.cause` |
| `KNOWLEDGE_POINTS` / `KNOWLEDGE_POINT_IDS` | 45 | `taxonomy.ts:144-197` | `Exercise.knowledgePoints`、`KnowledgeState.knowledgePointId` |
| `ACTIVITY_TYPES` | 7 | `taxonomy.ts:262-270` | `DailyPlanItemRecord.activity` |
| `JOURNAL_STEPS` | 8 | `taxonomy.ts:203-260` | `Journal.steps[].stepId` |

`Journal.steps[].stepId` 与 `JOURNAL_STEPS` 之间**没有 schema 级校验**（`lib/domain/journal.ts:15` 只要求非空字符串），编辑器按固定 id 写入（`features/journal/journal-views.tsx:237`）。新增步骤不会让旧数据报错，但会失去解释。`activityForExercise()` 把题型映射到活动类型，`reviewTags` 含"事实与推测"时优先返回 `fact-vs-inference`（`lib/domain/catalog.ts:41-62`）。

## 6. 备份文件（JSON 信封）

`exportBackup()`（`lib/db/store.ts:345-385`）的结构由 `BackupPayload`（`lib/db/store.ts:31-50`）定义，键清单见 `BACKUP_TOP_KEYS`/`BACKUP_DATA_KEYS`（`lib/db/store.ts:578-599`）。顶层：`app` 必须是字面量 `'logicdaily'`；`backupSchemaVersion` = `BACKUP_SCHEMA_VERSION = 1`（`lib/db/database.ts:20`）；`localDbVersion` 取 `this.db.verno`；**时间戳键名是 `exportedAt`，本格式没有顶层 `generatedAt`**（`generatedAt` 只存在于每条 `DailyPlanRecord` 内）；`profileId` 非空字符串；`counts` 只统计 4 项：`attempts`、`journals`、`plans`、`aiAnalyses`。

`data` 的 10 个键固定为 `settings`、`attempts`、`knowledgeStates`、`reviewStates`、`journals`、`plans`、`progress`、`exerciseIssues`、`aiAnalyses`、`aiUsage`。`knowledgeStates`/`reviewStates` 导出时被 `stripProfile` 剥掉 `profileId`（`lib/db/store.ts:375-376`、`559-563`），导入时按文件的 `profileId` 补回（`lib/db/store.ts:457`、`468`）。题库不进备份，由内容包重新播种。

结构示例（`profileId = 'local'`，导出于 2026-10-09T04:30:00Z = `1791520200000`；各数组只保留一条代表元素）：

```json
{
  "app": "logicdaily", "backupSchemaVersion": 1, "localDbVersion": 1,
  "exportedAt": 1791520200000, "profileId": "local",
  "counts": { "attempts": 1, "journals": 1, "plans": 1, "aiAnalyses": 0 },
  "data": {
    "settings": {
      "profileId": "local", "displayName": "我", "onboarded": true, "dailyBudgetMinutes": 10, "newToReviewRatio": 0.4,
      "preferredCategories": ["conditional-reasoning"], "restWeekdays": [0], "difficultyBias": 0.5,
      "timezone": "Asia/Shanghai", "journalDailyReminder": true, "theme": "system",
      "reminders": { "enabled": false, "time": "20:00", "quietStart": "22:30", "quietEnd": "07:30", "weeklyReviewDay": 0, "paused": false },
      "ai": { "enabled": false, "provider": "openai-compatible", "model": "", "baseUrlLabel": "", "temperature": 0.4, "timeoutMs": 25000, "maxOutputTokens": 900, "dailyCallLimit": 20 }
    },
    "attempts": [
      { "id": "atp-mv0gvdc0-ex-cond-001", "profileId": "local", "exerciseId": "ex-cond-001", "exerciseVersion": 1, "dateKey": "2026-10-09", "createdAt": 1791520200000,
        "answer": { "format": "single-choice", "keys": ["B"] }, "outcome": "incorrect", "score": 0, "timeSpentSeconds": 38, "confidence": 3,
        "reasoning": "没有贴绿标，可能只是漏贴。", "selfReport": null, "errorTypes": ["denying-antecedent"], "cause": "logic-skill",
        "planItemId": "item-1", "isReview": false, "flaggedForReview": false, "aiAnalysisId": null }
    ],
    "knowledgeStates": [
      { "knowledgePointId": "modus-tollens", "ewma": 0.3145, "attempts": 3, "correct": 1, "partial": 0, "incorrect": 1, "recentErrorTypes": ["denying-antecedent"], "lastAttemptDateKey": "2026-10-09", "updatedAt": 1791520200000 }
    ],
    "reviewStates": [
      { "exerciseId": "ex-cond-001", "ease": 2.3, "intervalDays": 1, "repetitions": 0, "lapses": 1, "dueDateKey": "2026-10-10", "sameDayRelearn": true, "sameDayRelearnAfterTs": 1791522000000, "leech": false, "lastOutcome": "incorrect", "lastConfidence": 3, "lastErrorTypes": ["denying-antecedent"], "updatedAt": 1791520200000 }
    ],
    "journals": [
      { "id": "j-mp9zq0", "profileId": "local", "title": "涨价后销量为什么更高", "problem": "涨价与销量同时上升，是否说明需求曲线向上？",
        "background": "", "facts": "连续两周涨价，销量仍上升。", "assumptions": "", "conclusion": "更可能是竞品缺货导致的替代。",
        "alternativeExplanations": "", "keyUncertainties": "", "verificationActions": "", "reviewOutcome": "", "reviewDelta": "unknown", "steps": [],
        "evidence": [{ "id": "e-1", "journalId": "j-mp9zq0", "stance": "oppose", "text": "同期竞品宣布缺货", "source": "公告", "reliability": 4, "createdAt": 1791454500000 }],
        "tags": ["消费", "因果"], "selfConfidence": 3, "status": "open", "reviewDueDateKey": "2026-10-16",
        "createdAt": 1791454500000, "updatedAt": 1791520000000, "deleted": false, "deletedAt": null, "aiConsent": false }
    ],
    "plans": [
      { "id": "plan-local-2026-10-09", "profileId": "local", "dateKey": "2026-10-09", "budgetMinutes": 10, "restDay": false,
        "items": [{ "id": "item-1", "activity": "error-review", "exerciseId": "ex-cond-001", "journalId": null, "estimatedSeconds": 50, "reason": "上次答错，安排当天再看一次，重点读解析里标出的推理步骤。", "kind": "same-day-relearn", "required": true }],
        "notes": ["包含 1 项当天重学（答错后约 30 分钟重复）。"], "generatedAt": 1791520200000, "algorithm": "logicdaily-daily-plan-v1" }
    ],
    "progress": [
      { "dateKey": "2026-10-09", "profileId": "local", "planId": "plan-local-2026-10-09", "completedItemIds": ["item-1"], "skippedItemIds": [], "totalSeconds": 38, "attempts": 1, "updatedAt": 1791520200000 }
    ],
    "exerciseIssues": [], "aiAnalyses": [], "aiUsage": []
  }
}
```

### 6.1 导入前的拒绝规则

`validateBackupPayload()`（`lib/db/store.ts:602-649`）按顺序检查，任一条不过即抛错，整个导入被 `features/me/me-view.tsx:402` 捕获并提示：

1. 载荷不是对象 → "备份文件不是一个对象。"；缺 7 个顶层键之一 → "备份缺少字段：X"；`app !== 'logicdaily'` → "这不是 LogicDaily 的备份文件。"
2. `backupSchemaVersion` 不是 `1..BACKUP_SCHEMA_VERSION` 的整数 → 版本不支持；`profileId` 不是非空字符串 → 拒绝
3. `data` 不是对象，或缺 10 个 `data.X` 之一 → "备份缺少 data.X"
4. `data.settings` 走 `migrateSettings()`：结构不合即抛错，并**剥离 `ai.apiKey` / `ai.key` / `ai.token`**（`lib/domain/settings.ts:103-109`）
5. `data.journals` 每条走 `journalSchema.parse`；`data.attempts` 每条必须 `id` 与 `exerciseId` 都是字符串

其余数组只做类型断言、不逐条校验，缺失即回退 `[]`（`lib/db/store.ts:640-646`）。题目 JSON 导入走同一份 schema：`parseExerciseRows()`（`lib/db/store.ts:652-654`）。

### 6.2 导入的冲突与去重规则

`importBackup()`（`lib/db/store.ts:387-511`）在一个读写事务里按 store 应用不同规则，返回 `{ added, merged, skipped }`：

| store | 规则 |
| --- | --- |
| `settings` | 无条件用文件内容覆盖，键为文件的 `profileId` |
| `attempts` | 按 `id` 去重：已存在则 `skipped`，绝不改写作答历史 |
| `journals` | 同 `id` 比 `updatedAt`：文件更新才覆盖（`merged`），否则 `skipped`；无旧值则 `added` |
| `reviewStates` / `knowledgeStates` | 复合键查旧值，`prior.updatedAt >= 新值` 即 `skipped`，否则覆盖 |
| `plans` | 用 `[profileId, dateKey]` 查旧值，`prior.generatedAt >= 新值` 即 `skipped`（不计入返回值） |
| `progress` | 同上，比较 `updatedAt` |
| `exerciseIssues` / `aiAnalyses` / `aiUsage` | 无条件 `put`（按 `id` 覆盖），不计数 |
| `syncState` | 重置为 `{ localRevision: 旧值+1, lastSyncedAt: null, lastSyncedRevision: 0, pendingOps: 0, conflicts: merged, mode: 'local' }`，事务后再调一次 `bumpRevision` |

`options.replaceExisting` 为真时事务开始先删该 profile 的 `attempts`、`journals`、`reviewStates`、`knowledgeStates`（**不含 `plans` 与 `progress`**，`lib/db/store.ts:415-420`）；界面当前不传该选项，只调 `importBackup(JSON.parse(text))`（`features/me/me-view.tsx:398`）。`clearLocalData()`（`lib/db/store.ts:513-547`）删该 profile 的 9 个数据 store + `settings` + `syncState` + `meta.onboarded:*`；题库默认一起清空，`{ keepExercises: true }` 时保留（`lib/db/store.ts:544`）。日志硬删除走 `deleteJournalPermanently()`，id 不存在或不属于该 profile 时抛 `RevisionConflictError`（`lib/db/store.ts:549-556`）。

## 7. 版本与迁移规则

- **Dexie schema 版本**：只有 `version(1)`，尚无 `version(2)`。任何加 store / 加索引都要新增 `this.version(2).stores({...})` 并同步 `LOCAL_DB_VERSION`；已发布的 v1 定义不可原地修改，否则老用户升级失败。
- **备份 schema 版本**：`BACKUP_SCHEMA_VERSION = 1`。`validateBackupPayload` 接受 `1..BACKUP_SCHEMA_VERSION`，即只兼容"旧文件在新应用"，不接受未来高版本（`lib/db/store.ts:609-612`）。提升该常量时必须同时为新增的 `data` 键补默认值，否则旧文件会因缺键被拒。
- **设置迁移**：`migrateSettings()`（`lib/domain/settings.ts:90-116`）是唯一升级路径，读库时（`app/providers.tsx:105-107`）与导入时（`lib/db/store.ts:620`）都经过它。规则：`targetMinutes` → `dailyBudgetMinutes`；删除 `targetMinutes` 与 `mode`；空/缺 `profileId` 补 `'local'`；`ai` 与 `reminders` 与默认值**浅合并**（否则旧备份缺新增嵌套字段会让整份解析失败）；丢弃 `ai.apiKey`/`key`/`token`；最后 `settingsSchema.parse`。新增设置项的正确做法是加 zod 默认值，而不是写数据修补。
- **题目内容与版本**：题目是随应用分发的只读内容，不进备份。三层版本协同：单题 `version`（决定播种时是否覆盖）、内容包标签 `EXERCISE_CONTENT_TAG = 'content-v1.0'`（写进 `seededFrom`，`lib/content/packs.ts:19`）、文件 `schemaVersion`。重新播种的触发条件在 `app/providers.tsx:70-79`：本地题数与内容包不一致，或存在本地题目的 `id`/`version` 在内容包里找不到。
- **播种的增/改/删语义**：`seedExercises()`（`lib/db/store.ts:137-161`）——新 `id` 记 `inserted`；已有同 `id` 且 `version` 与 `seededFrom` 都相同则跳过；否则覆盖记 `updated`；批次里没有、且 `seededFrom` 等于本次标签的行被删除记 `removed`；来自其他标签的行保留（这也是回滚内容包会留残余的原因）。
- **AI 提示词版本**：每个任务有独立版本字符串（如 `analyze-reasoning-v2`，`lib/ai/prompts/analyze-reasoning.ts:3`），服务端回传后存进 `AIUsageRecord.promptVersion` 与 `AIAnalysisRecord.promptVersion`，用于事后对比提示词效果。

## 8. profile 隔离规则

- 每一个属于用户的数据行都携带 `profileId`：`attempts`、`journals`、`plans`、`progress`、`exerciseIssues`、`aiAnalyses`、`aiUsage` 有 `profileId` 字段；`knowledgeStates`、`reviewStates`、`settings`、`syncState` 把它放进复合主键或主键。**没有全局共享的用户数据 store**：唯一不含 `profileId` 的是只读题库 `exercises` 与预留的 `meta`。
- 访客 profile 的 id 是字面量 `'local'`（`app/providers.tsx:11`），`defaultSettings('local')` 与 `migrateSettings` 的缺省值都指向它（`lib/domain/settings.ts:99-101`）。当前应用没有别的 profile 创建入口，但数据层已按多 profile 设计，测试用 `'p1'`/`'p2'` 验证隔离（`tests/integration/local-store.test.ts:131-150`）。
- 读取一律带 profile：`listAttempts`、`listJournals`、`listKnowledgeStates`、`listReviewStates`、`listPlans`、`listProgress` 都以 `profileId` 为范围起点；`getJournal()` 在行不属于该 profile 时返回 `null` 而不是抛错（`lib/db/store.ts:237-240`）；写入用 `put({ ...state, profileId })` 强制覆盖字段，杜绝串号（`lib/db/store.ts:208`、`223`）。
- 要记住的例外：`listIssues()` 不带 profile 过滤（`lib/db/store.ts:285-288`）；`aiAnalyses`/`aiUsage` 的列表查询先 `toArray()` 再在 JS 里过滤 `profileId`（`lib/db/store.ts:295-298`、`310-319`）。单 profile 下正确，多 profile 下会读全库，属于性能与隔离强度的技术债。

## 9. 范围查询与复合键约定

- **Dexie 的 `between()` 默认左闭右开**，所有日期区间查询都必须显式传 `true, true`，否则边界那天（往往就是"今天"）被整段丢掉。已按此实现的三处：`lib/db/store.ts:189-194`（`attempts`）、`lib/db/store.ts:259-262`（`plans`）、`lib/db/store.ts:270-273`（`progress`）；`tests/integration/local-store.test.ts:105-129` 锁住了该行为。漏掉这两个布尔参数的症状是"最新记录消失"，不是报错。
- `listAttempts` 的缺省边界是字符串哨兵 `'0000-00-00'` 与 `'9999-99-99'`（`lib/db/store.ts:190-191`），后者不是合法日期但作为字符串上界有效；结果按 `createdAt` 升序，`limit` 取的是**最近** N 条（排序后 `slice(-limit)`，`lib/db/store.ts:197-199`）。
- 复合主键读写传数组：`db.reviewStates.get([profileId, exerciseId])`、`db.progress.get([profileId, dateKey])`（`lib/db/store.ts:218`、`266`）；`put` 时不传 key，由 Dexie 从索引字段推导。
- AI 用量按日统计用的是 `createdAt` + 时区换算，而非 `dateKey` 字段（`lib/db/store.ts:304-308`）。

## 10. 已知限制

- 未实现多标签页并发写入的冲突合并：同一 profile 在两个标签页同时作答，进度行可能被后写的一方覆盖。
- `importBackup` 不校验每条记录的 `profileId` 是否等于文件的 `profileId`（`attempts`、`journals` 按行内值写入），拼接或恶意备份可以写入其他 profile 的行。
- 以下是**已声明但无写入/无调用**的预留位，扩展时不要假设它们已被使用：`AttemptRecord.aiAnalysisId`、`AIAnalysisRecord.subjectKind` 的 `'attempt'`/`'profile'`、`AIUsageRecord.status` 的 `'rejected'`/`'degraded'`、`ExerciseIssueReport.status` 的后三个值、`meta` store、`SyncState.mode = 'cloud'`、`EXERCISE_CONTENT_VERSION`、`LOCAL_DB_VERSION`、三个复合键拼接助手。
- `plans`、`exerciseIssues`、`aiUsage` 的写入不自增 `localRevision`，因此修订号不能当作全量数据指纹用于同步。
- 题库只读且不留历史：`seedExercises` 直接覆盖，旧版本题目正文丢失，只剩作答记录里的 `exerciseVersion` 数字。
- 备份是明文 JSON，不加密；`counts` 只覆盖 4 项，不能用来核对完整性。
- 判分依赖题目里预先标注的 `errorType`/`checkpoint.keywords`，未标注的选项不会贡献错误类型；开放题没有客观评分，只记录自评。

## 11. 扩展新表时要做的事

按顺序执行，缺一步会在老用户设备上静默出错：

1. 在 `lib/domain/` 定义记录类型或 zod schema，字段全部显式声明并给默认值；用户数据必须含 `profileId` 与 `createdAt`/`updatedAt`（软删除再加 `deleted`/`deletedAt`）。
2. 在 `lib/db/database.ts:25-38` 加 `Table<T, PK>` 声明，并在 `version(...).stores({...})` 里加 store 定义。若要为将来的云端模式留镜像，同步 `supabase/migrations/0001_init.sql`（列名 snake_case、注释标明对应的 TS 字段）与 `0002_auth_rls.sql`（`owner_id` 隔离策略）。云端表结构是本地记录的镜像（`supabase/migrations/0001_init.sql` 的每个列注释都写明对应的 TS 字段，索引镜像 Dexie 的索引，`0002_auth_rls.sql` 负责 `owner_id` 隔离），加表时要一并补 SQL——注意这套 SQL 目前不在应用运行路径与 CI 里，改动不会被自动验证。
3. **不要修改 `version(1)`**：新写法放进 `this.version(2).stores({...})`（只写需要变更的 store，Dexie 会继承旧定义），并把 `LOCAL_DB_VERSION` 改成 2。
4. 决定主键形态：单条可追加的记录用 `id`；"每 profile 每 X 一行"用复合主键 `[profileId+xxx]`，读写用数组形式。
5. 为每个真实查询计划建索引，按 `profileId` 打头建复合索引，避免 `toArray()` 后过滤。
6. 在 `DataStore` 接口（`lib/db/store.ts:63-113`）加方法签名，再在 `LocalStore` 实现：读取必须带 `profileId`；写用户数据后调 `bumpRevision(profileId)`；范围查询传 `true, true`。
7. 若要进备份：把键加进 `BackupPayload['data']`（`lib/db/store.ts:38-49`）、`BACKUP_DATA_KEYS`（`lib/db/store.ts:588-599`）、`exportBackup` 的 `Promise.all` 与返回值、`importBackup` 的事务与冲突规则、`clearLocalData` 的事务表与删除语句。新增必填键会让旧备份被拒——必须同时提升 `BACKUP_SCHEMA_VERSION` 并在 `validateBackupPayload` 里为缺失键补默认值，或把新键设为可选并保持 `BACKUP_DATA_KEYS` 不变。
8. 冲突规则要与产品语义一致：追加型（作答）按 `id` 去重；文档型（日志）按 `updatedAt` 后者胜；状态型（复习/掌握度）按 `updatedAt` 比较；快照型（计划）按 `generatedAt` 比较。
9. 加迁移：配置类走 `migrateSettings` 风格的"默认值浅合并 + parse"；结构化记录加 `if (backupSchemaVersion < N)` 分支。
10. 在 `tests/integration/local-store.test.ts` 补：读写往返、profile 隔离（两个 profile 互不干扰）、导出→清除→导入恢复、非法备份被拒、新表在 `clearLocalData` 中被清干净。
11. 更新本文件第 2、3、6 节的表格与 `README.md` 的数据说明；新增枚举时同步 `scripts/content-enums.mjs` 里那份手写枚举副本（校验脚本不导入 TS，所以只能有副本），`tests/integration/content.test.ts` 的「校验脚本的枚举副本」用例会立刻发现漂移。
