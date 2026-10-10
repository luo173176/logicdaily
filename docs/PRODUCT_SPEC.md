# LogicDaily 产品规格说明书

本文件把原始需求文档（962 行中文需求，项目立项时提供）转写为可实现、可验证的产品规格，并逐条标注本仓库的实现状态。需求中的条款以「需求 §x.y」引用；实现状态只描述代码实际做到的事，不描述计划。

配套文档：数据层细节见 [docs/DATA_MODEL.md](DATA_MODEL.md)，界面截图见 `docs/images/`。

## 1. 产品目标

构建一个中文的**日常逻辑思维训练系统**，把逻辑推理、批判性思维、因果分析、论证分析和现实问题解决融进用户的每一天。核心命题不是"会做题"，而是"能把自己的推理过程写下来、被检验、并在几天后接受现实结果的复盘"。

五条目标（对应需求 §2）：

1. 每天 5～15 分钟即可完成一次有效训练。
2. 不只训练答对，还训练说明推理、检验论据、识别自己的思维漏洞。
3. 把真实生活里的工作、学习、阅读、新闻、消费、沟通问题转成训练材料。
4. 依据作答表现、错误类型与训练历史动态调整内容与复习计划。
5. 用大模型提供个性化反馈，但不把模型的主观判断当作绝对正确的事实。

产品边界（需求 §3、§4.9、§4.10 的共同取向）：本地优先、可解释、不夸大。所有指标必须能展开看到计算方式；样本不足时必须写"样本不足"；不能声称科学测量了用户的智力或逻辑能力。

## 2. 目标用户与使用场景

| 用户                   | 场景                                     | 产品承担的角色                                                 |
| ---------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| 需要日常做判断的职场人 | 面对两个机会、一次涨价、一个流程问题     | 用八步向导把模糊困惑写成可检验的问题                           |
| 阅读新闻与研究报告的人 | 看到"相关即因果""样本很小却下结论"的材料 | 材料论证分析、错误类型命名、反例提示                           |
| 备考或自学逻辑的人     | 需要条件推理、真假话、统计直觉的练习     | 14 类题型练习 + 确定性判分 + 间隔复习                          |
| 关注数据自主的人       | 不想把私人思考交给第三方服务器           | 全本地 IndexedDB 存储、明文 JSON 自主备份、AI 明确同意后才发送 |

不服务的场景：不提供医疗、法律、投资等专业建议（`lib/ai/prompts/system.ts:15`），不做多人班级/企业培训管理，不做题库售卖。

## 3. 不可妥协的产品原则

这些原则在代码里有强制体现，改动前必须保留：

| 原则                                           | 代码体现                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 判分链路不调用大模型，答案确定、可测、离线可用 | `lib/domain/grading.ts:357-375` 全部为确定性规则                                                             |
| 缺少 API Key 不阻塞任何核心流程                | `features/coach/coach-panel.tsx:170-178`、`lib/ai/service.ts:193-195`（`not_configured` → HTTP 503）         |
| 用户隐私正文默认不外发                         | `lib/domain/journal.ts:48`（`aiConsent` 默认 false）+ `lib/ai/service.ts:62`（服务端要求 `consented: true`） |
| 密钥只存在于服务端                             | `lib/domain/settings.ts:72-73`、`lib/domain/settings.ts:103-109`（导入时剥离 `apiKey`/`key`/`token`）        |
| 不把连续打卡当成功指标                         | `lib/domain/daily-plan.ts:261-294`（1 天宽限 + 休息日不断连击）、`lib/domain/stats.ts:362-367`               |
| 每个指标可解释、样本不足就明说                 | `lib/domain/stats.ts:12-13`（阈值 12/6）+ `lib/domain/mastery.ts:130-137`（公式原文回显）                    |
| 计划可复现，不使用 `Math.random`               | `lib/domain/daily-plan.ts:394-409`（以 `profileId + dateKey` 为种子）                                        |

## 4. 能力清单与验收标准

### C-01 使用模式与账户（需求 §4.1）

| 验收标准                             | 实现位置                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 无需注册即可完整体验，数据只存本机   | `app/providers.tsx:11`（访客 profile 为字面量 `'local'`）、`app/providers.tsx:95-135`                    |
| 未配置模型时基础训练功能完整可用     | `lib/ai/client.ts:39`（`not_configured` 文案）、`features/coach/coach-panel.tsx:170-178`                 |
| 可通过配置切换不同大模型服务         | `.env.example:10-22` + `lib/ai/config.ts:41-64`；客户端可覆盖模型名 `lib/ai/client.ts:82`                |
| 本地模式与云端模式有统一数据访问接口 | `lib/db/store.ts:63-113`（`DataStore`）、`lib/db/store.ts:116`（`mode`）                                 |
| 云端表结构与行级隔离有可执行脚本     | `supabase/migrations/0001_init.sql`、`0002_auth_rls.sql`（`owner_id` + RLS），但没有任何应用代码引用它们 |

**实现状态**：部分实现 —— 游客/本地/AI 可选三种模式完整；**云端账户、注册登录、跨设备同步在应用里没有实现**（Phase 3）：`app/`、`features/`、`lib/`、`components/` 中不存在 Supabase 客户端、`signIn` 或任何云端读写，`SyncState.mode` 恒为 `'local'`。云端侧目前只有接缝（`DataStore`）与 SQL 脚本，`supabase/README.md:7-13` 也明确写着"应用尚未使用这套 schema，执行迁移不会改变产品的任何行为"。需求里的"游客数据迁移到个人账户"因此不存在。多模型只支持 OpenAI 兼容协议，8 个供应商标签（`lib/domain/settings.ts:5-14`）不产生不同适配代码。

### C-02 首页与每日任务（需求 §4.2）

| 验收标准                                                                                         | 实现位置                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 首页展示今日进度、待完成任务、推荐内容、连续天数、本周情况、待复习错题、最近日志、快速开始主按钮 | `features/home/home-view.tsx:38-63`、`92`、`141`、`170-174`         |
| 每日任务可由 7 类活动组成（逻辑题、事实与推测、因果、论证、问题拆解、自由日志、错题复习）        | `lib/domain/taxonomy.ts:262-282`、`lib/domain/daily-plan.ts:55-228` |
| 可配置每日时长、难度倾向、偏好类别、休息日                                                       | `lib/domain/settings.ts:45-51`、`features/me/me-view.tsx:91-162`    |
| 休息日只减轻任务，不因中断产生惩罚                                                               | `lib/domain/daily-plan.ts:58-60`、`211-213`、`261-294`              |

**实现状态**：完整实现。

### C-03 中文题库与内容治理（需求 §4.3）

| 验收标准                                                                                                                        | 实现位置                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 覆盖 14 个题类，首版 ≥100 道经过检查的中文题                                                                                    | `content/exercises/`（14 个文件 × 8 题 = 112 题）、`lib/domain/taxonomy.ts:1-16`                                                                                                               |
| 每题含 id、内容、题型与知识点、难度、来源说明、答案、解析、推理步骤、常见错误及原因、可接受的其他答案、复习标签、版本、验证状态 | `lib/domain/exercise-schema.ts:56-145`；真实样例见 `content/exercises/conditional-reasoning.json`                                                                                              |
| 标准答案用确定性判分，不每次问模型                                                                                              | `lib/domain/grading.ts:357-375`                                                                                                                                                                |
| 开放题用量表与明确评价标准，并提供人工复核/用户反馈                                                                             | `lib/domain/exercise-schema.ts:117-136`、`lib/domain/records.ts:65-74`（`ExerciseIssueReport`）、`features/me/me-view.tsx:442`                                                                 |
| 每题经过逻辑一致性检查（前提不足、答案不唯一、解析自相矛盾）                                                                    | `scripts/validate-exercises.mjs:69-170`（正确选项不得挂 `errorType`、挂了的必须在解析里解释、`correctRatio > partialRatio`、重复题干/重复 id 检测），CI 强制运行（`.github/workflows/ci.yml`） |

**实现状态**：完整实现（内容层面）。需求 §7 里的 `ExerciseVersion` 实体没有做成历史版本表：`version` 只是一个整数，重新播种会覆盖旧正文，历史内容不可追回（详见 DATA_MODEL 第 7、10 节）。难度值是编辑判断，未做样本化标定。

### C-04 互动答题流程（需求 §4.4 第 1～10 步）

| 验收标准（10 步）                         | 实现位置                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| 展示题目 → 用户作答 → 允许说明推理 → 提交 | `features/training/training-view.tsx:301-330`（`reasoning`、`confidence`、计时） |
| 显示结果、展示详细解析                    | `features/training/training-view.tsx:556-575`                                    |
| 识别可能的错误推理模式                    | `lib/domain/grading.ts:34-39`、`lib/domain/mistake.ts:126-136`                   |
| 记录时间、答案、信心与反馈                | `lib/services/training.ts:68-90`（`AttemptRecord`）                              |
| 更新掌握度、把适合复习的题目加入队列      | `lib/services/training.ts:92-122`                                                |
| 选项顺序不暴露正确答案位置                | `lib/domain/catalog.ts:87-90`（按题目 id + 日期稳定打乱）                        |

**实现状态**：完整实现。

### C-05 错因分析与归因（需求 §4.4 错误类型与区分要求）

| 验收标准                                                         | 实现位置                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 至少 15 种错误类型（肯定后件、否定前件、以偏概全……推理步骤缺失） | `lib/domain/taxonomy.ts:54-110`（15 项 + 中文名 + 释义）                          |
| 区分真正的逻辑错误、知识不足、粗心、题目理解错误                 | `lib/domain/mistake.ts:38-164`（7 种 `CauseType` 的显式优先级链）                 |
| 用户可在看完解析后修正归因                                       | `features/training/training-view.tsx:372-380`、`lib/services/training.ts:333-394` |
| 修正归因不得改动得分与复习排期                                   | `lib/services/training.ts:333-336`                                                |

**实现状态**：完整实现。

### C-06 真实生活思考日志（需求 §4.5，产品的核心差异化）

| 验收标准                                                                                                                                | 实现位置                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16 个字段（标题、问题、背景、事实、假设、结论、支持/反对证据、其他解释、关键不确定、验证行动、复盘结果、自评信心、创建/更新时间、标签） | `lib/domain/journal.ts:20-49`；支持/反对证据由 `evidence[].stance` 四态表达而非两个独立字段                                                       |
| 八步思考向导                                                                                                                            | `lib/domain/taxonomy.ts:203-260`、`features/journal/journal-views.tsx:237`                                                                        |
| 允许快速记录，不强迫填满                                                                                                                | `lib/domain/journal.ts:70-84`、`app/journal/new/page.tsx`                                                                                         |
| 全文搜索、标签过滤、编辑、删除、导出、复盘                                                                                              | `lib/domain/journal.ts:103-131`、`features/journal/journal-views.tsx:58`、`419-428`（单篇 JSON 导出）、`447-448`（软删除）、`357-363`（复盘日期） |
| 区分练习表现与现实结果                                                                                                                  | `lib/domain/stats.ts:229-264`（`journalStats` 单独统计日志行为指标）                                                                              |
| 私人日志默认不发外部模型                                                                                                                | `lib/domain/journal.ts:48` + `features/coach/coach-panel.tsx:95`                                                                                  |

**实现状态**：完整实现。

### C-07 AI 思维教练（需求 §4.6）

| 验收标准                                                                                                                                                                                | 实现位置                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 真正可调用的模型服务，供应商可配置，不绑定单一厂商                                                                                                                                      | `lib/ai/provider.ts`（OpenAI 兼容适配层）、`lib/ai/config.ts:41-64`                                                            |
| 12 项能力中的 11 项有对应任务：分析推理、指出缺失前提、区分事实/假设/推测、识别谬误、提出反例、追问证据来源、分析现实问题、按薄弱项推荐练习、阶段性反馈、复盘过往判断、材料论证结构分析 | `lib/ai/output-schema.ts:84-91`（6 个任务）+ `lib/ai/service.ts:123-169`                                                       |
| 默认苏格拉底式引导：先提问、不直接公布答案、完成尝试后才示范                                                                                                                            | `lib/ai/prompts/system.ts:7-23`、`lib/ai/output-schema.ts:40-50`（`questions` 为必填）                                         |
| 结构化输出包含论证结构、可肯定处、问题、支持/反对证据、其他解释、下一步验证、不确定性、推荐知识点                                                                                       | `lib/ai/output-schema.ts:13-38`                                                                                                |
| 不把模型输出当绝对事实；按不可信输入做结构校验                                                                                                                                          | `lib/ai/service.ts:227-242`（zod 校验失败即丢弃；推荐题目 id 必须存在于题库）                                                  |
| 超时、重试、错误日志、用量统计、成本控制                                                                                                                                                | `lib/ai/provider.ts`、`lib/ai/ratelimit.ts`、`lib/db/store.ts:300-308`（`AIUsageRecord`）、`app/api/ai/analyze/route.ts:56-68` |
| 提示词模板独立存放、可测试、有版本                                                                                                                                                      | `lib/ai/prompts/`，版本号如 `analyze-reasoning-v2`（`lib/ai/prompts/analyze-reasoning.ts:3`）、`system-v3`                     |
| 未配置 Key 时给出清晰指引，其余功能正常                                                                                                                                                 | `features/me/me-view.tsx:253-275`、`lib/ai/client.ts:39`                                                                       |

**实现状态**：部分实现 —— 上述能力均已落地，但需求第 12 项"根据用户偏好调整解释深度"没有对应的设置字段或提示词参数（`AppSettings` 无该项，`lib/ai/client.ts:79-86` 只发送 model/temperature/maxOutputTokens）。

### C-08 大模型配置中心与安全边界（需求 §4.7）

| 验收标准                                                               | 实现位置                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公开配置与秘密配置严格分离；Key 不进前端代码、公开变量、构建产物或 Git | `lib/ai/config.ts:1-6`、`.env.example:8-22`、`.gitignore:20`（`.env*` 被忽略，`.env.example` 例外）                                                                                          |
| 模型请求经服务端路由转发，浏览器只访问本站接口                         | `app/api/ai/analyze/route.ts`、`lib/ai/client.ts:72-86`                                                                                                                                      |
| 认证、限流、输入长度、输出限制、防未授权与费用滥用                     | `app/api/ai/analyze/route.ts:22-31`（同源校验）、`39-53`（只有配了 `TRUST_PROXY_HEADERS` 才信任转发头）、`71-83`（按分钟 + 每日上限）、`lib/ai/service.ts:200-202`、`lib/ai/config.ts:57-62` |
| 对外部 Base URL 做 SSRF 防护，阻断元数据地址、内网、localhost          | `lib/ai/ssrf.ts`、`lib/ai/service.ts:171-183`（默认只允许服务端配置的地址，`AI_ALLOW_LOOPBACK` 仅开发态）                                                                                    |
| 不把 Key、认证头、敏感正文写入普通日志                                 | `app/api/ai/analyze/route.ts:72-81`、`106-107`（只记 `evt/task/model/ms/tokens/status`）                                                                                                     |
| 模型响应视为不可信输入，不执行其中指令                                 | `lib/ai/prompts/system.ts:23`、`lib/ai/service.ts:227-242`                                                                                                                                   |

**实现状态**：部分实现（有意为之的偏离）。需求允许"用户配置 API Key / API Base URL"，本仓库**不让用户在客户端填密钥**：客户端只有 `baseUrlLabel` 展示字段，真实凭据由部署者在服务器环境变量里配置。因此需求里的"用户自带凭据的加密存储策略"未实现，也不在计划内。限流是单进程内存实现，多实例部署需换共享存储（`lib/ai/ratelimit.ts`）。`settings.ai.dailyCallLimit` 现在两侧都生效：客户端在发起调用前用 `store.countAIUsageToday()` 拦截（`features/coach/coach-panel.tsx:62-70`、`features/coach/material-view.tsx:70-74`），服务端 `AI_DAILY_LIMIT` 为权威配额（`app/api/ai/analyze/route.ts:69-80`），界面提示（`features/me/me-view.tsx:327`）如实写成"本机自我约束 + 服务端权威配额，以先到的一方为准"。**这一条是修过的真 bug**：原先设置项只被保存与展示、没有任何代码用它拦截，而界面却承诺两侧都检查。客户端只把 `model`、`temperature`、`maxOutputTokens` 传给服务端（`lib/ai/client.ts:82-84`）。

### C-09 间隔复习与个性化训练（需求 §4.8）

| 验收标准                                                                 | 实现位置                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 可测试、可解释的调度算法，参考 SM-2 但不过度设计                         | `lib/domain/scheduling.ts:5-20`（LD-SRS，上限 45 天）、`lib/domain/scheduling.ts:117-169`      |
| 记录最近结果、信心、错误类型、难度、复习次数、掌握度、下次复习时间       | `lib/domain/scheduling.ts:22-39`、`lib/domain/mastery.ts:11-23`                                |
| 调度考虑新旧题比例、薄弱知识点、重复错误类型、时间预算、休息日、难度渐进 | `lib/domain/daily-plan.ts:55-228`（六项全部参与打分）                                          |
| 掌握度有明确计算规则，界面说明含义与局限                                 | `lib/domain/mastery.ts:71-137`（EWMA 公式与"不等于逻辑能力测量"的原文说明）                    |
| 不因少数几次答对就断言能力提升                                           | `lib/domain/mastery.ts:8-9`（3 次以下不出百分比）、`lib/domain/stats.ts:12-13`                 |
| 界面能解释"这道题为什么排到今天"                                         | `lib/domain/scheduling.ts:207-214`（`describeSchedule`）、`features/review/review-view.tsx:97` |

**实现状态**：完整实现。

### C-10 训练报告与成长分析（需求 §4.9）

| 需求列出的页面/指标                            | 实现位置                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 今日训练报告、每周复盘、每月趋势               | `features/stats/stats-view.tsx:33`（时间范围切换 `今天/本周/近 30 天/全部`）、`256`（本周复盘）、`143`（近 30 天序列） |
| 题型掌握度、错误类型分布、训练完成率、复习效果 | `lib/domain/stats.ts:125-197`、`199-227`                                                                               |
| 思考日志统计、用户主动标记的实际问题结果       | `lib/domain/stats.ts:229-264`、`lib/domain/journal.ts:32-34`（`reviewOutcome`/`reviewDelta`）                          |
| 个性化训练建议，且数据不足时不生成结论         | `lib/domain/stats.ts:317-385`（每条建议带 `basis`）                                                                    |
| 报告必须能解释每项指标的计算方式               | `lib/domain/stats.ts:15-23`（`Metric.formula` 强制字段，界面展开显示）                                                 |
| 区分练习成绩、学习行为与现实表现               | `lib/domain/stats.ts:247-255`（"这是行为指标：你是否在寻找反对证据，而不是成绩"）                                      |

**实现状态**：基本完整 —— 唯一偏差是"每月趋势"实现为**滚动近 30 天**窗口，不是自然月。

### C-11 日常提醒（需求 §4.10）

| 验收标准                                            | 实现位置                                                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自定义训练时间、免打扰时段、暂停提醒                | `lib/domain/settings.ts:54-63`（`TIME_RE` 校验）、`features/me/me-view.tsx:165-210`                                                                   |
| 本地提醒 / 浏览器通知（获得授权后，不默认强制授权） | `features/me/me-view.tsx:215-227`（用户点击才 `Notification.requestPermission()`）、`components/reminder-gate.tsx:55-61`（授权后 `new Notification`） |
| 每日任务提示、未完成任务提醒、每周复盘提醒          | `lib/services/reminders.ts:37-88`（`decideReminder` 的四种决策）、`components/reminder-gate.tsx:40-54`（页内横幅 + toast）                            |
| 应用启动时执行提醒决策                              | `app/layout.tsx:64`（`<ReminderGate />` 挂在根布局）                                                                                                  |
| 如实说明 PWA 后台推送的限制                         | `components/reminder-gate.tsx:12-18`、`lib/services/reminders.ts:33-36`、`features/me/me-view.tsx:230-233`、`docs/ANDROID.md`                         |

**实现状态**：大部分实现（前台） —— 设置项、免打扰与休息日判定、决策纯函数（`tests/unit/reminders.test.ts` 覆盖）、根布局里的执行端、页内横幅与系统通知都已接通；每日最多表达一次靠 `localStorage` 的 `logicdaily:reminder-fired:<dateKey>` 去重（`components/reminder-gate.tsx:10`、`52`），与主题偏好一样属于 IndexedDB 之外的少量本机状态（`lib/ai/client.ts:137`）。仍缺的部分：没有服务端推送（代码中不存在 `PushSubscription` 注册，`public/sw.js` 无 `push`/`notificationclick` 处理器），因此提醒只在页面被打开时生效；PWA 无法保证后台准时唤醒，这一点在界面与文档里都如实写明，可靠到点的提醒需要原生包装层，而原生层未构建（见 C-14）。`ReminderGate` 本身没有自动化测试覆盖。

### C-12 设置、隐私与数据管理（需求 §4.11）

| 验收标准                                     | 实现位置                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 修改训练偏好、每日目标、提醒、主题           | `features/me/me-view.tsx:91-260`                                                                                               |
| 查看隐私说明与 AI 数据使用说明               | `features/me/me-view.tsx:417-425`                                                                                              |
| 导出数据、导入备份，导入前验证文件结构与版本 | `lib/db/store.ts:345-385`、`602-649`、`features/me/me-view.tsx:368-407`                                                        |
| 删除指定日志、清除本地数据                   | `features/journal/journal-views.tsx:447-448`（软删除）、`lib/db/store.ts:549-556`（硬删除）、`features/me/me-view.tsx:428-440` |
| 查看数据同步状态                             | `lib/db/store.ts:321-343` + `features/me/me-view.tsx:357`（展示 `mode` 与本地修订号，并注明云端同步未启用）                    |
| 删除云端账户与关联数据                       | 不适用（云端账户未实现，见 C-01）                                                                                              |

**实现状态**：本地部分完整实现；"删除云端账户"整条不适用；`importBackup` 不校验行内 `profileId` 与文件 `profileId` 是否一致（多 profile 场景下的隔离缺口）。

### C-13 移动端与 PWA（需求 §5.1）

| 验收标准                                         | 实现位置                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 可安装到主屏幕、`standalone` 竖屏                | `app/manifest.ts`（含 shortcuts、maskable 图标）                                                                                                                                                                       |
| HTTPS 下的 Service Worker 与合理离线能力         | `public/sw.js`（外壳 stale-while-revalidate、静态资源缓存优先、**`/api/*` 一律不缓存**）、`components/service-worker-registration.tsx`、`app/offline/page.tsx`                                                         |
| 底部导航包含首页、训练、思考日志、复习、我的     | `components/nav.tsx:7-11`                                                                                                                                                                                              |
| 触屏友好、重要操作不依赖悬停、适配安全区与软键盘 | `app/globals.css:77-78`（`env(safe-area-inset-*)`）、`app/layout.tsx:31-36`（`viewport`，含 `viewportFit: 'cover'`）、长文本输入不被导航遮挡由 e2e 验证（`tests/e2e/data-and-ai.spec.ts:198`，注意它只覆盖无键盘情形） |
| 中文阅读字体与行距、浅色/深色主题                | `app/globals.css`、`lib/ai/client.ts:130-141`（主题应用与本地记忆）                                                                                                                                                    |
| 清晰的加载/空/成功/错误反馈                      | `components/ui.tsx`（Skeleton、Note、Chip、Button）、`app/providers.tsx:185-191`（全局 `aria-live` toast）                                                                                                             |
| 控制资源体积，避免大型依赖                       | Web 目标的运行时依赖 6 个（next/react/dexie/dexie-react-hooks/zod）；`@capacitor/core` 与 `@capacitor/android` 只在 APK 目标用到，静态导出的前端资源实测 91 个文件 / 1,725,157 字节                                    |

**实现状态**：完整实现，并有手机视口的端到端验证（`tests/e2e/data-and-ai.spec.ts:183`，`devices['Pixel 7']` 实测 412×839，8 条路由无横向溢出）。

### C-14 Android 原生应用（需求 §5.2）

| 验收标准                                                                                     | 实现状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 先评估 PWA 是否满足需求，只有必要才加原生层                                                  | 已按此执行：先交付 PWA，之后本机装上 JDK 17 + Android SDK 才构建原生壳。`android/` 是 `npx cap add android` 真实生成的工程，不是空目录凑数                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 若采用 Capacitor：工程可实际构建、权限与网络配置、签名模板、Debug/Release 区分、提供构建说明 | **已实现并构建成功**：`@capacitor/*@6.2.2`，`capacitor.config.ts` 指定 `webDir: 'apk-web'` 且**不设** `server.url`（从包内本地资源加载），`android.allowMixedContent: false`、`server.androidScheme: 'https'`。`android/variables.gradle` 实测 minSdk 22 / compileSdk 34 / targetSdk 34。**权限最小化**：`android/app/src/main/AndroidManifest.xml` 只声明 `android.permission.INTERNET`（Capacitor 必需，给 WebView 自身），构建产物里另见 AGP 自动注入的 `com.logicdaily.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`；没有存储、通知、定位、相机权限。Gradle `assembleDebug` → `BUILD SUCCESSFUL in 1m 29s`，产物 4,732,472 字节，`aapt2 dump badging` 实测 `com.logicdaily.app` versionCode 1 / versionName 1.0 / minSdk 22 / target 34 / compileSdk 34。Debug 与 Release 已区分说明（Release 需自建 keystore，见 `docs/ANDROID.md` 5.5，**该步骤未执行**）。构建与验证步骤写在 README「手机使用」与 `docs/ANDROID.md` 第 4 节 |
| 环境缺少 SDK 时完成可验证的工程配置并指出未执行的步骤                                        | 已如实说明：真机安装未做（`adb devices` 为空）、Release 未做、上架未做、包内 AI 不可用（没有 Node 服务端）——见 `README.md` 已知限制、`docs/ANDROID.md` 第 6 节                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**实现状态**：已实现（纯离线单机 APK）。**注意两点诚实边界**：（1）没有在任何真机或模拟器上安装运行过，功能验证针对的是打进包内的那份静态资源（`npm run verify:apk-web`，14 项）；（2）APK 内 AI 思维教练不可用，因为该能力必然经服务端转发给模型，界面显示「未启用」而非崩溃，这一条有专门的自动化检查。代价是 C-11 的可靠后台提醒仍未兑现 —— 原生壳本身不带来本地通知插件。

### C-15 界面风格与首次引导（需求 §8）

| 验收标准                                                 | 实现位置                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 简洁、专注、避免过度游戏化与无意义动画                   | `app/globals.css`（无动效依赖，卡片式层级）                                                                                                          |
| 训练入口始终易找                                         | `components/nav.tsx:7-11` + `app/manifest.ts` shortcuts + `features/home/home-view.tsx:141`                                                          |
| 支持键盘操作与屏幕阅读器，保持对比度，不只用颜色表达对错 | `app/providers.tsx:185`（`aria-live`）、`components/nav.tsx:19`（`aria-label`）、`features/stats/stats-view.tsx:333`（图表带 `role="img"` 文字替代） |
| 首次打开提供简短引导，可跳过，未配置 AI 也能用           | `features/onboarding/onboarding-view.tsx:29-45`、`166-169`                                                                                           |
| 复杂逻辑概念提供例子                                     | `lib/domain/taxonomy.ts:92-110`（每种错误类型带示例释义）                                                                                            |

**实现状态**：部分实现 —— 引导实际为 3 步（时长 / 感兴趣的领域 / 数据保存在哪里）+ 最后一屏直接进入第一道题，`onboarded` 写入设置（`lib/domain/settings.ts:43`）。需求里的"选择本地模式或配置云端功能"这一步退化为纯说明文案，因为云端模式未实现。

### C-16 数据模型与一致性（需求 §7）

需求要求至少 16 个实体。实现把它们收敛为 13 个 Dexie store，字段级说明见 [docs/DATA_MODEL.md](DATA_MODEL.md)。对照结果：

| 需求实体                              | 实现                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User                                  | 应用内无云端用户实体，以 `profileId`（当前恒为 `'local'`）承担所有权；`supabase/migrations/0001_init.sql` 已把它设计成 `owner_id uuid references auth.users` |
| UserSettings / NotificationPreference | `settings`（含 `reminders` 子对象）                                                                                                                          |
| Exercise / ExerciseVersion            | `exercises`（`version` 为整数，无历史版本行）                                                                                                                |
| ExerciseAttempt                       | `attempts`                                                                                                                                                   |
| KnowledgePoint / UserKnowledgeState   | 词表在 `lib/domain/taxonomy.ts:144-197`（45 项，不进库）；`knowledgeStates`                                                                                  |
| ReviewSchedule                        | `reviewStates`                                                                                                                                               |
| ThoughtJournal / JournalEvidence      | `journals`（证据与向导作答内嵌为数组）                                                                                                                       |
| AIAnalysis / AIUsageRecord            | `aiAnalyses`、`aiUsage`                                                                                                                                      |
| DailyPlan / DailyProgress             | `plans`、`progress`                                                                                                                                          |
| DataSyncState                         | `syncState`（字段齐备，只有本地值被写入）                                                                                                                    |

一致性规则已实现的部分：稳定的唯一 id、创建/修改时间、软删除标记与硬删除分离、导入时的冲突检测（较新 `updatedAt`/`generatedAt` 胜出，重复作答跳过）、单调修订号；云端侧另有 `0002_auth_rls.sql` 的所有者隔离策略与 `0003_seed_exercises.sql` 的可重入题库种子。未实现的部分：网络恢复后的同步、删除标记的跨端传播（`Journal.deleted` 只在本地与备份里存在）、退出登录后的本地数据处理（因为没有登录）。

**实现状态**：部分实现（本地一致性与备份/恢复完整；跨设备同步链路在应用里不存在，只有 SQL 与 `DataStore` 接缝）。

### C-17 工程质量、测试与持续集成（需求 §10、§11、§6 工程质量）

| 验收标准                                                                                                                                 | 实现位置                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript strict、ESLint                                                                                                                | `tsconfig.json`、`eslint.config.mjs`、`npm run typecheck`                                                                                                                                                                                                                                                                                                                                        |
| 单元测试覆盖判分、结构校验、错因、调度、计划、掌握度、时间、导入导出、AI 校验与降级                                                      | `tests/unit/`（12 个文件）+ `tests/integration/`（3 个，跑在 fake-indexeddb 上）                                                                                                                                                                                                                                                                                                                 |
| 端到端覆盖首次打开、完成一题、看解析、错题复习、日志增删改、统计、刷新后仍在、AI 未配置可用、AI 异常提示、手机视口、导出恢复、删除后行为 | `tests/e2e/core-flow.spec.ts`、`tests/e2e/data-and-ai.spec.ts`（Playwright，Pixel 7 / 393×851 视口）                                                                                                                                                                                                                                                                                             |
| 安全测试覆盖跨用户读取、Key 不外泄、限流、非法导入被拒、危险 URL 被拒、敏感信息不入日志                                                  | `tests/unit/ai-security.test.ts`、`tests/integration/local-store.test.ts:217-243`                                                                                                                                                                                                                                                                                                                |
| GitHub Actions 在 PR 与主干更新时跑依赖安装、类型检查、规范、测试、构建                                                                  | `.github/workflows/ci.yml`（`check` → `e2e` 两段作业）                                                                                                                                                                                                                                                                                                                                           |
| 环境变量模板                                                                                                                             | `.env.example`                                                                                                                                                                                                                                                                                                                                                                                   |
| 结构化日志、错误监控接口                                                                                                                 | 仅 AI 路由输出结构化 JSON 行（`app/api/ai/analyze/route.ts:87-96`、`121-123`）；没有统一日志层，也没有错误监控接入                                                                                                                                                                                                                                                                               |
| 数据库迁移可执行                                                                                                                         | `supabase/migrations/0001_init.sql`（镜像 `lib/domain` 各记录的表结构）、`0002_auth_rls.sql`（13 张表启用 RLS，49 条按 `owner_id` 隔离的策略）、`0003_seed_exercises.sql`（由 `scripts/export-sql-seed.mjs` 从 `content/exercises/*.json` 生成）、`0000_local_stubs.sql`（仅供本地校验，明确禁止用于真实项目）；`supabase/README.md:102` 记录了在一次性 Docker Postgres 上应用迁移的本地校验步骤 |

**实现状态**：部分实现 —— 类型、规范、三层测试、CI、环境变量模板、云端 SQL（含 RLS）都在。缺口有四：（1）`npm run format:check` 未纳入 CI；（2）没有错误监控接口，也没有统一日志层，只有 AI 路由的结构化 JSON 行；（3）云端 SQL 的跨用户隔离是**手工验证**的（`supabase/README.md:102-146` 记录了一次性 Docker Postgres 上四条迁移全部零错误应用，并用 `set role authenticated` + `request.jwt.claims` 证明了双用户互不可见、越权写入被 RLS 拒绝），但没有固化成自动化测试：CI 里没有 Postgres 作业，`tests/` 下也没有 RLS 用例，所以需求 §7 的"通过测试验证跨用户访问被拒绝"目前只有可复现的操作记录，没有回归保障；（4）**从未部署过任何环境**，需求 §11 的"构建与测试通过后才自动部署"没有被验证过。

### C-18 仓库与文档（需求 §9）

需求要求 `README.md` 覆盖介绍、功能清单、截图、架构、安装、命令、环境变量、数据库初始化、AI 配置、测试、部署、安卓使用方式、FAQ、已知限制与路线图 —— `README.md` 全部具备（截图来自 `docs/images/`，由 `scripts/capture-screenshots.mts` 对生产构建实际截取）。

需求列出的其他文档均已存在：`docs/ARCHITECTURE.md`、`docs/DATA_MODEL.md`、`docs/PRODUCT_SPEC.md`、`docs/AI_INTEGRATION.md`、`docs/PRIVACY.md`、`docs/DEPLOYMENT.md`、`docs/ANDROID.md`、`docs/USER_GUIDE.md`、`supabase/README.md`，根目录的 `CONTRIBUTING.md`、`SECURITY.md`、`CHANGELOG.md`、`LICENSE`。`README.md:133-140`、`.env.example:33`、`features/me/me-view.tsx:232`、`271` 里的链接都能解析到实际文件。

**实现状态**：完整实现，但两点要如实记下：（1）`docs/DEPLOYMENT.md` 与 `supabase/README.md` 描述的是未执行的流程 —— 本仓库从未部署到任何环境，`supabase/migrations` 也没有被应用运行时使用；（2）文档由多人并行撰写，与本文件对同一功能的措辞可能存在时间差，冲突处以代码为准。`LICENSE` 为 AGPL-3.0-or-later，与 `package.json` 声明一致。

## 5. 阶段对照（需求 §12）

| 阶段                              | 状态                 | 说明                                                                                                                                                                                                        |
| --------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 环境检查与技术调研        | 完成                 | 技术选型（Next.js 16 + Dexie + Zod + Playwright）与 MVP 范围已落进代码结构                                                                                                                                  |
| Phase 1 可运行的核心 MVP          | 完成                 | 中文界面、每日任务、题库、答题判分、解析、本地持久化、错题、复习、日志、统计、112 题、自动化测试                                                                                                            |
| Phase 2 AI 思维教练               | 完成（能力 12 缺 1） | 适配层、服务端调用、提示词版本、结构化校验、超时重试、限额、用量记录、安全控制、降级                                                                                                                        |
| Phase 3 账户与跨设备同步          | 未实现（应用侧）     | 已有 `DataStore` 接缝、`syncState` 字段与云端 SQL（`supabase/migrations/` 共 13 张表、RLS 49 条策略、题库种子）；但无登录、无 Supabase 客户端、无同步逻辑，执行迁移不改变产品行为                           |
| Phase 4 移动端完善与 Android 评估 | 完成                 | PWA 与纯离线 APK 两条路都交付：`android/` 工程真实构建成功（debug 包 4.51 MB），包内资源经 Playwright 14 项验证。后台提醒的可靠性缺口仍保留（前台提醒已接通，见 C-11；APK 未引入原生本地通知插件，见 C-14） |
| Phase 5 发布与维护                | 部分                 | 文档已齐（含 `CHANGELOG.md`、`CONTRIBUTING.md`、`SECURITY.md`），但从未部署，也没有实际执行过云端迁移                                                                                                       |

## 6. 需求与实现不一致之处

这一节记录代码与需求文本发生冲突或被需求遗漏的地方，属于有意取舍：

1. **API Key 的所有权**：需求 §4.7 允许用户配置 API Key；实现把密钥限制为服务端环境变量，客户端设置连字段都不接受（`lib/domain/settings.ts:72-73`，导入时主动剥离，`lib/domain/settings.ts:103-109`）。取舍理由是本地优先应用无法保护浏览器里的密钥。
2. **"支持多模型"的深度**：需求 §4.1 说允许切换不同大模型服务；实现只有 OpenAI 兼容一种协议适配（`lib/ai/service.ts:204`），设置里的 8 个供应商标签不会改变请求形态。
3. **提醒的语义被收窄**：需求 §4.10 的"本地提醒/浏览器通知"在实现里明确为**只在应用被打开时表达一次**（`components/reminder-gate.tsx:12-18` 把这条限制写进了代码注释与界面文案），去重状态放在 `localStorage` 而不是 IndexedDB；后台唤醒与推送订阅因 PWA 限制而不承诺，需求也允许这样如实说明（§4.10 第 378 行）。
4. **每日调用上限是两侧生效、以先到的一方为准**：需求 §4.7 要求可配"每日调用次数上限"。实现有两道闸：客户端在 `features/coach/coach-panel.tsx:62-70` 与 `features/coach/material-view.tsx:70-74` 用 `store.countAIUsageToday()` 拦截并给出 `local_budget` 文案；服务端 `lib/ai/ratelimit.ts` 的 `AI_DAILY_LIMIT` 是权威配额。这是**修过的**：原先设置项完全不起作用而界面写着"两侧都会检查"，属于文档与代码不符。界面提示现在如实写成"这是本机的自我约束；服务端另有权威配额，以先到的一方为准"。
5. **"每月趋势"的口径**：需求 §4.9 按月，实现按滚动 30 天窗口，避免月初样本为零的错觉（`features/stats/stats-view.tsx:33`）。
6. **支持证据与反对证据**：需求 §4.5 把它们列为两个字段；实现用一条证据数组加 `stance` 四态（支持/冲突/支持另一种解释/不确定）表达，能表达更多情况（`lib/domain/journal.ts:3-12`）。
7. **`ExerciseVersion` 实体**：需求 §7 要求版本实体，实现只有 `version` 整数与被覆盖的旧正文，题目历史不可追回。
8. **`KnowledgePoint` 实体**：需求 §7 要求为实体，实现是代码里的 45 项常量词表（`lib/domain/taxonomy.ts:144-197`），不进 IndexedDB，因此不能按 profile 增删自定义知识点。
9. **打卡与惩罚**：需求 §4.2 要求不把连续打卡当唯一成功指标；实现更进一步——连续天数带 1 天宽限且休息日不断连击，并在报告里显式说明它不作为成功指标（`lib/domain/daily-plan.ts:261-294`、`lib/domain/stats.ts:362-367`）。
10. **需求未要求、但实现主动加的护栏**：判分链路禁止调用模型；Service Worker 禁止缓存 `/api/*`（避免 AI 状态被缓存）；端到端测试使用固定深链接而不依赖当日计划（`AGENTS.md` 项目约定）。

## 7. 已知限制

诚实清单，与 `README.md` 的已知限制保持一致：

- **云端账户与同步在应用里未实现**（Phase 3）：没有注册、登录、同步代码，`SyncState.mode` 恒为 `'local'`。`supabase/migrations/` 有 13 张表 + RLS 49 条策略 + 题库种子，`supabase/README.md:7-13` 明确说明"应用尚未使用这套 schema，装上迁移也不会改变产品行为"；隔离效果有一次性 Docker Postgres 上的手工验证记录（`supabase/README.md:102-146`），但 CI 里没有 Postgres 作业，`tests/` 里也只有本地 `profileId` 层面的隔离用例（`tests/integration/local-store.test.ts:167-172`）。
- **APK 未在真机上运行**：`android/` 工程与 debug 包真实构建成功（`docs/ANDROID.md` 第 4 节有 Gradle 输出、`aapt2` 元数据、包内 93 个资源条目与 `apk-web/` 的逐路径比对），打进包内的那份资源由 `npm run verify:apk-web` 验证 14 项。但 `adb devices` 为空，**没有安装到任何真机或模拟器**，所以原生层行为未验证；并且是 debug 签名，不能上架；包内 AI 不可用（没有 Node 服务端，界面显示「未启用」）。PWA 与 APK 的存储是两个不同域，训练记录不互通。
- **提醒只在应用打开时生效**：`components/reminder-gate.tsx` 在根布局里执行当日决策（页内横幅 + 已授权时的系统通知），但没有 `PushSubscription`、`public/sw.js` 也没有 `push`/`notificationclick` 处理器，关闭页面后不会有任何提醒；APK 同样没有引入原生本地通知插件；`ReminderGate` 自身没有自动化测试。
- **AI 依赖服务端密钥**：`AI_API_KEY`/`AI_BASE_URL` 缺失时接口返回 `not_configured`（503），所有 AI 功能降级为说明文案，训练主流程不受影响。纯静态部署没有服务端路由时，状态接口不可达（`lib/ai/client.ts:57-70`）。
- **限流为单进程内存实现**：多实例部署需要共享存储（`lib/ai/ratelimit.ts`）。
- **多标签页并发写入未做冲突合并**：同一 profile 在两个标签页同时作答，进度行可能被后写一方覆盖。
- **题库为原创中文题，未经样本化难度标定**：112 题通过结构校验、答案自洽检查与人工解析编写，难度值是编辑判断。
- **AI 反馈质量取决于所配模型**：输出契约只保证结构与来源可控，不保证洞见。
- **文档与代码的时间差**：`docs/` 下 8 份文档 + 根目录 3 份都已存在且链接可解析，但 `docs/DEPLOYMENT.md` 与 `supabase/README.md` 描述的部署与迁移流程**从未在本仓库执行过**；README 里的测试数量（"211 个单元/集成测试 + 17 个端到端测试"）是编写时的统计，新增代码不保证仍落在同一覆盖范围内。任何数字与本文件冲突时，以代码与 `file:line` 为准。
