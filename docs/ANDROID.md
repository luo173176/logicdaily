# LogicDaily 在 Android 上：现在能用成什么样

## 0. 结论先说

- **推荐用法就是 PWA**：在 Chrome for Android 上打开你的部署地址 → 菜单 → 「添加到主屏幕」，之后以 `standalone` 独立窗口运行，训练、日志、复习、报告全部离线可用。
- **没有 APK**。本仓库从未构建过 Android 安装包，也没有 `android/` 目录。
- **本机不具备打包条件**：这台机器上没有 Java JDK、没有 Android SDK、没有 adb，`@capacitor/*` 也不是依赖。下面第 4 节贴了我亲自跑的验证命令和真实输出。
- 因此本文第 4、5 节里的 Capacitor 步骤是**给愿意自己装环境的读者的说明**，标注为「在你的机器上执行」，**不是**这里做过的、也不是验证过的操作。照做之后能不能成功，本文不承诺。

写这份文档时，本仓库同样从未部署过，部署相关见 `docs/DEPLOYMENT.md`。要在手机上试用，你需要先用某种方式把它跑在一个 HTTPS 地址上（本机 `http://localhost` 只能用于同一台机器的调试，且 Service Worker 之外的手机访问不会是安全上下文）。

## 1. 安装为 PWA：步骤与前提

### 1.1 前提（本仓库的实际配置）

Chrome 判定「可安装」需要的东西，逐条对照本仓库：

| 条件                               | 本仓库状态                                                                                                                                                                                                         | 依据（实测文件）                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| HTTPS（或 localhost）              | 由你的部署提供                                                                                                                                                                                                     | `components/service-worker-registration.tsx:13` 只在 `https:` 或 `localhost`/`127.0.0.1` 下注册 SW |
| `start_url` 可访问、在 `scope` 内  | `id`/`start_url` = `/`，`scope` = `/`                                                                                                                                                                              | `app/manifest.ts`                                                                                  |
| Web App Manifest 被链接            | `metadata.manifest = '/manifest.webmanifest'`，由 `app/manifest.ts`（`MetadataRoute.Manifest`）动态生成；实测该 URL 返回 `content-type: application/manifest+json`                                                 | `app/layout.tsx:19`                                                                                |
| 图标 ≥192px 与 ≥512px，且 maskable | `/icons/icon-192.png`、`/icons/icon-512.png`、`/icons/icon-maskable-512.png`（purpose 分别为 `any`/`any`/`maskable`）；4 个 PNG 文件实测存在于 `public/icons/`                                                     | `app/manifest.ts`、`public/icons/`                                                                 |
| 已注册且能工作的 Service Worker    | `public/sw.js`，`scope: '/'`，`updateViaCache: 'none'`                                                                                                                                                             | `components/service-worker-registration.tsx:54`                                                    |
| 名称/显示模式                      | `name`、`short_name` = `LogicDaily`，`display: standalone`，`display_override: ['standalone','minimal-ui']`，`orientation: portrait-primary`，`background_color` `#f6f6f4`，`theme_color` `#2f5d88`，`lang: zh-CN` | `app/manifest.ts`                                                                                  |
| 桌面长按菜单快捷方式               | 3 条：`/train`「开始今天的训练」、`/journal/new`「写思考日志」、`/review`「复习错题」                                                                                                                              | `app/manifest.ts:25-29`                                                                            |

`/manifest.webmanifest` 与 `/sw.js` 是否 200，可以用 `docs/DEPLOYMENT.md` 第 9.3 节的 curl 先确认。

### 1.2 步骤（在你的手机上执行）

1. Chrome for Android 打开你的站点根地址。
2. 首次加载需要联网：页面会在浏览器 IndexedDB 里创建数据库 `logicdaily` 并播种 112 道题（见 `app/providers.tsx` 的流程）。等首页出现「今日训练」内容再往下走。
3. 菜单（右上角的三点按钮）→「添加到主屏幕」/「安装应用」。Chrome 若没主动给出入口，也可以访问 `chrome://apps` 或在地址栏右侧找安装图标。
4. 之后从桌面图标启动：独立窗口、无地址栏，竖屏（manifest 建议 `portrait-primary`）。
5. 想让 Chrome 主动弹安装提示（beforeinstallprompt）需要满足上面的全部条件；没弹不代表不能用，手动添加即可。

其他浏览器的说明（属于一般性事实，未在本仓库逐一实测）：Edge、Samsung Internet 等基于 Chromium 的浏览器提供同类「安装」入口；Firefox for Android 的 PWA 安装能力与 Chromium 不完全一致；各类「内置 WebView 的浏览器」（例如在聊天工具内打开的页面）通常根本不提供安装入口——请用系统自带或独立的浏览器完成添加。iOS Safari 也能添加主屏幕，但那不是 Android，且其存储配额策略可能清理长期不用的站点数据。

### 1.3 更新怎么生效

`components/service-worker-registration.tsx` 的策略（实测代码）：新 Service Worker 装好后**不自动接管**，页面底部出现「有新版本可用。」+「重新加载」按钮；点它才向 waiting worker 发 `skipWaiting` 并 `location.reload()`。另外每 1 小时会主动 `registration.update()` 一次。所以你在手机上更版本后，看到那个提示再点，正在作答的内容不会被突然刷新。

## 2. 离线之后：能用什么

数据在 IndexedDB，所以「离线可用」靠的是**外壳 + 分块缓存**，而不是缓存接口。`public/sw.js`（实测全文 96 行）的真实策略，按请求类别逐条：

| 请求类别                                                     | 策略（代码依据）                                                                                                                               | 实际效果                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 安装期预缓存                                                 | `SHELL_URLS = ['/', '/offline', '/icons/icon-192.png', '/icons/icon-512.png']`，`install` 里 `cache.addAll`（`sw.js:10,13-20`）                | 首页外壳与离线页保证第一次断网就有兜底                                                                    |
| `/_next/static/`、`/icons/`、`/fonts/`                       | 缓存优先，命中就直接返回；未命中才走网络并把副本写进缓存（`sw.js:11,45-58`）                                                                   | 已发布过的哈希 JS/CSS chunk 长期离线可用                                                                  |
| 导航请求（`mode === 'navigate'` 或 `Accept` 含 `text/html`） | **网络优先**；成功且 `response.ok` 就更新缓存；失败则依次回落：本次 URL 的缓存 → `/` 的缓存 → `/offline` → `Response.error()`（`sw.js:60-78`） | 断网时从桌面图标进入任意页面，通常仍拿到已缓存的那一页；没缓存过就落到首页；连首页都没有就落到 `/offline` |
| 其他同源 GET（含按路由拆分的 JS/CSS 分块）                   | 网络优先，失败回落缓存（`sw.js:80-91`）                                                                                                        | 第一次联网访问过的路由，之后离线可打开                                                                    |
| **`/api/*`**                                                 | `if (url.pathname.startsWith('/api/')) return;`（`sw.js:42-43`）**直接放行网络，永不缓存**                                                     | AI 调用不会被重复计费，配置状态实时                                                                       |
| 非 GET                                                       | 直接不拦截（`sw.js:37`）                                                                                                                       | 提交类请求不被 SW 干预                                                                                    |
| 跨源请求                                                     | `url.origin !== self.location.origin` 时不拦截（`sw.js:40`）                                                                                   | 若你自己放了外部字体/CDN，离线时它们会失败                                                                |
| 缓存版本                                                     | 固定名 `logicdaily-v1`；`activate` 删除所有不同名的缓存（`sw.js:9,22-29`）                                                                     | 改代码里的缓存名即可强制清干净旧缓存                                                                      |
| 非安全上下文                                                 | 不注册 SW（见 1.1）                                                                                                                            | 用 `http://` 内网 IP 访问时，**离线能力为零**                                                             |

离线**可用**的功能（因为逻辑全在客户端）：今日计划、答题与判分、错因归类、解析、思考日志的创建/编辑/软删除、复习队列与 LD-SRS 排期、训练报告、主题切换、数据导出/导入。首页的 `/offline` 页面本身也这样告诉用户（实测文案：「打开已缓存的页面、查看今日计划与解析 / 作答、写思考日志（数据保存在本机 IndexedDB）/ 复习队列与统计（全部计算在本地）」）。

离线**不可用**的功能：

- **AI 思维教练**全部不可用（教练页、日志的 AI 审阅、材料论证分析、题目推荐、周报）。原因不是「没缓存」，而是设计上 `/api/*` 必须联网到服务端再转发给模型。`lib/ai/client.ts` 在网络失败时返回 `code: 'network'`，界面文案是「无法连接模型服务」。
- 从未在联网状态下访问过的路由，第一次离线打开可能拿不到分块（回落顺序见上表）。
- 首次安装时（缓存还是空的）离线基本什么都做不了 —— 所以**装完先在联网状态下把主要页面点一遍**。

一句诚实的补充：**这套离线行为没有被端到端测试覆盖**。实测 `tests/e2e/*.spec.ts` 里没有任何 `context.setOffline()` 调用，`tests/e2e/data-and-ai.spec.ts` 的「AI 降级」用例反而先注销 SW 并清空 caches（`:104-113`）以便桩掉路由。上表是对 `sw.js` 的逐行阅读结论，不是真机断网验证结果。

## 3. 键盘、安全区与竖屏：CSS 里到底写了什么

### 3.1 视口与方向

- `app/manifest.ts:16` 设了 `orientation: 'portrait-primary'`。这是 manifest 的**建议值**，浏览器/系统是否强制不锁定不保证；不要把它当成「横屏被禁用」的既成事实。
- `app/layout.tsx:30-38` 的 `viewport` 导出只有 `width: 'device-width'`、`initialScale: 1`、`maximumScale: 5` 和 `themeColor`（浅色 `#f6f6f4` / 深色 `#14161a`，按 `prefers-color-scheme` 分派）。
- **注意：没有设置 `viewportFit`。** 在生产实例上实测拿到的 HTML 是：

```text
$ curl -s http://127.0.0.1:3123/ | grep -o '<meta name="viewport"[^>]*>'
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover"/>
```

`viewport-fit=cover` 已在 `app/layout.tsx` 的 `viewport` 导出里设置（Next 16 的 `Viewport` 类型支持它：`node_modules/next/dist/lib/metadata/types/extra-types.d.ts:52`）。

- 历史背景（值得知道，因为它曾经是个真 bug）：这一项**曾经缺失**，导致 `app/globals.css` 里给 `html` 加的 `padding: env(safe-area-inset-top) … env(safe-area-inset-left)` 与 `components/nav.tsx` 的 `paddingBottom: 'env(safe-area-inset-bottom)'` 在实践中全部解析为 0——安全区代码写了但没生效。加上 `viewportFit: 'cover'` 之后它们才真正起作用。
- 除安全区变量之外，仍有**固定尺寸补偿**在兜底（即使某个浏览器不支持 `env()` 也不会挡住内容）：
  - `app/layout.tsx`：内容容器 `mx-auto … min-h-dvh w-full max-w-[520px]`，`<main>` 是 `px-4 pt-4 pb-28`（底部留 7rem）。
  - `components/nav.tsx`：`fixed inset-x-0 bottom-0 z-40 max-w-[520px]`，每个 tab `min-h-[52px]`，`bg-surface/95 backdrop-blur`。
  - `maximumScale: 5` 允许双指缩放，对可读性是好事。
  - 提醒横幅用 `bottom-[calc(env(safe-area-inset-bottom)+4.75rem)]` 浮在导航之上。

### 3.2 触控目标与输入

实测 `app/globals.css`：

- `textarea, input[type=text|number|time|search], select`：`min-height: 44px`、`border-radius: 10px`、`padding: 10px 12px`、`width: 100%`，注释写的就是「触控目标不小于 44px」。
- `.btn`：`min-height: 48px`；`.btn-sm`：`min-height: 40px`。
- `body`：`font-size: 16px`（16px 是避免移动端浏览器在聚焦时自动放大的常见阈值）、`line-height: 1.7`、`-webkit-text-size-adjust: 100%`、`text-rendering: optimizeLegibility`，字体栈优先 `PingFang SC`/`Hiragino Sans GB`/`Microsoft YaHei`/`Noto Sans CJK SC`（中文阅读取向）。
- `textarea`：`resize: vertical`（手机上可纵向拉长，不会横向破版）。
- `button, input, textarea, select`：`font: inherit; color: inherit` —— 继承中文正文与主题色，不会出现系统默认小字。
- `:focus-visible` 有 2px 轮廓 + 2px offset；`.skip-link` 提供「跳到主要内容」（`app/layout.tsx:49-51`）。
- `@media (hover: hover)` 才给悬停反馈，`[data-pressable]:active` 提供按下位移（`translateY(1px)`）；`@media (prefers-reduced-motion: reduce)` 把动画/过渡压到 0.001ms。
- 颜色不单靠色相表达状态（`.status-ok/warn/bad` 配文字与图标字符），深色主题走 `data-theme="dark"` 变量覆盖，`layout.tsx:9` 有一段内联脚本在首屏前定主题，避免深色模式闪白。

### 3.3 软键盘

代码里**没有**任何 `visualViewport` 监听或键盘高度补偿逻辑（实测 `grep -rn "visualViewport" app lib components features` 无输出，exit=1）。实际表现由这几件事共同决定：

- 容器高度用 `min-h-dvh`（`dvh` 会随移动浏览器的 URL 栏/工具栏变化，而不是被键盘挤压）。
- 长文本框在滚动流里，键盘弹起时浏览器把聚焦元素滚进视口；导航是 `fixed` 且 `z-40`，所以理论上仍可能盖住底部输入区 —— 靠 `main` 的 `pb-28` 缓冲。
- 这一条有测试但标题不准：`tests/e2e/data-and-ai.spec.ts:183` 的用例「长文本输入不会被底部导航遮挡」断言的是 `/journal/new` 第一个标注输入的 `y + height < viewport.height`；`:168` 的用例标题写着「393×851」，但配置 `playwright.config.ts:20` 用的是 `devices['Pixel 7']`。实测该描述符（下面这段是本会话真实输出）与标题不一致，应以 412×839 为准。
- 本会话**没有**跑过 e2e（`127.0.0.1:3123` 已有本仓库的 `next start` 实例在监听，Playwright 的 `webServer` 默认也占 3123），所以「键盘弹起不遮挡」在真机上仍未验证。

```text
$ node -e "const {devices}=require('@playwright/test'); console.log(JSON.stringify(devices['Pixel 7'],null,1))"
{
 "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Mobile Safari/537.36",
 "viewport": {
  "width": 412,
  "height": 839
 },
 "screen": {
  "width": 412,
  "height": 915
 },
 "deviceScaleFactor": 2.625,
 "isMobile": true,
 "hasTouch": true,
 "defaultBrowserType": "chromium"
}
```

## 4. 环境实测：这台机器上到底有没有打包 Android 的条件

下面的命令都是我在 Git Bash（Windows）里真实执行的，输出原样粘贴。`where` 的「找不到」消息是 GBK 编码，Git Bash 里直接显示为乱码，所以我额外用 `iconv` 转了一遍并标注。

```text
$ java -version
/usr/bin/bash: line 1: java: command not found
exit=127

$ where java
信息: 用提供的模式无法找到文件。          # 原始输出为 GBK 乱码，已用 iconv -f GBK -t UTF-8 还原；exit=1

$ where adb
信息: 用提供的模式无法找到文件。          # 同上；exit=1

$ echo "[${ANDROID_HOME:-unset}] [${ANDROID_SDK_ROOT:-unset}] [${JAVA_HOME:-unset}]"
[unset] [unset] [unset]

$ ls -d "$LOCALAPPDATA/Android" ; ls -d "$PROGRAMFILES/Android"
ls: cannot access 'C:\Users\luo17\AppData\Local/Android': No such file or directory
ls: cannot access 'C:\Program Files/Android': No such file or directory

$ ls node_modules/.bin | grep -i cap
（无输出：node_modules/.bin 里没有 cap 可执行文件）

$ npx --no-install cap --version
npm error could not determine executable to run
exit=1

$ timeout 90 npx cap --version < /dev/null
npm error could not determine executable to run
exit=1
```

说明最后一条：我把 stdin 关闭了，因此 npm 没有在「是否下载 `@capacitor/cli`」的交互提示上等待，而是直接报「找不到可执行文件」退出。**本会话没有下载或安装任何 Capacitor 包**（也就没有改动 `package.json` / `node_modules`）。

再看依赖与目录（实测）：

```text
$ node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies))"
[ 'dexie', 'dexie-react-hooks', 'next', 'react', 'react-dom', 'zod' ]

$ node -e "const p=require('./package.json');console.log(Object.keys(p.devDependencies))"
[ '@playwright/test', '@tailwindcss/turbopack', '@types/node', '@types/react',
  '@types/react-dom', '@vitest/coverage-v8', 'eslint', 'eslint-config-next',
  'eslint-config-prettier', 'fake-indexeddb', 'prettier', 'tailwindcss', 'typescript', 'vitest' ]

$ ls -d android
ls: cannot access 'android': No such file or directory
```

结论，逐条对应上面的证据：

- 没有 Java JDK（`java: command not found`，`JAVA_HOME` 未设置）。
- 没有 Android SDK / platform-tools（`adb` 找不到、`ANDROID_HOME` 与 `ANDROID_SDK_ROOT` 未设置、SDK 常见安装目录不存在）。
- 没有 Capacitor：既不是 `dependencies` 也不是 `devDependencies`，`node_modules/.bin` 里没有 `cap`。
- 没有 `android/` 工程目录，也没有 `capacitor.config.ts`。
- Gradle 无从运行（连 JDK 都没有）。

所以：**Capacitor / Gradle 打包在这台机器上没有尝试过，连尝试的前提都不存在**。本文其余部分关于 APK 的一切都写成「你如果要自己做，需要先满足什么」，不写成「做过」。

## 5. 为什么暂时没有 APK，以及真要做得装什么

### 5.1 为什么 PWA 目前够用

核心功能全部离线、数据在浏览器本地、没有账号体系、没有后台服务。安装后是独立窗口 + 桌面图标 + 长按快捷方式，对「每天 5～15 分钟做一道题、写一篇日志」这件事，浏览器壳提供的能力和原生壳差别不大；而原生壳会额外带来签名、上架、版本升级、审核等长期成本。AGPL-3.0-or-later 下，多一个分发渠道就多一份源码公开义务的对接工作。

### 5.2 什么情况下才真的需要原生壳

- 需要**可靠到点的提醒**（下面 5.3 展开）。
- 需要系统级分享/接收文本（把一篇文章丢进 App 让它拆解论证）之类的 intent。
- 希望在应用商店被搜到、或在不装 Chrome 的设备分发。
- 需要避开浏览器对存储的清理策略（站点数据被系统/用户清除时 IndexedDB 会一起没）。

### 5.3 通知与推送的真实状态（本仓库）

这是最容易误判的一块，逐条摆事实。下面三条都是本会话在 Git Bash 里真实跑的 grep，检索范围限定代码目录（`app lib components features scripts tests public content`），以免被 Markdown 文档自身的叙述污染：

```text
$ grep -rn "PushSubscription\|pushManager\|showNotification\|new Notification(" app lib components features scripts tests public content
（无输出，exit=1）

$ grep -rn "decideReminder" app lib components features
./lib/services/reminders.ts:37:export function decideReminder(
```

1. **没有 Web Push。** `PushSubscription`、`pushManager` 在代码目录里零命中；`public/sw.js` 里没有 `push`/`notification` 事件监听器（实测全文 96 行，只有 `install`、`activate`、`fetch`、`message` 四个）。也就是说：没有订阅、没有应用服务器密钥（VAPID）、没有保存订阅的服务端接口。因此**关掉 App、关掉网页之后，没有任何机制能把 LogicDaily 唤醒并通知你**。
2. **连前台通知都没接线。** `features/me/me-view.tsx` 里只有权限处理：读取 `Notification.permission` 显示状态（`:43-46`、`:216`）和一个「请求通知权限」按钮调 `Notification.requestPermission()`（`:217-229`）。`new Notification(`、`showNotification` 零命中 —— 拿到了权限也没有任何地方去构造通知。
3. **提醒决策函数是纯逻辑，运行时没有调用点。** `lib/services/reminders.ts` 的 `decideReminder()` 实现了：开关/暂停、今天已提醒过、休息日不打扰、未到点、超过 2 小时窗口不再打扰、免打扰时段（支持跨午夜 22:30–07:30 这类区间）、每周复盘日、待办数/逾期优先。上面的 grep 显示代码目录里只有它的定义行，没有任何调用；唯一使用它的是 `tests/unit/reminders.test.ts`。
4. 该文件自己的注释就是官方口径（实测 `reminders.ts:33-36`）：

   > PWA 无法保证后台准时唤醒（浏览器与系统都会限制），因此这里只做「应用处于打开状态时的当日提醒」。真正的可靠后台提醒需要原生包装层，见 docs/ANDROID.md 的说明。

   界面上也照这个说了（`me-view.tsx:230-233`）：「作为网页应用，只有页面开着（或 Service Worker 被系统唤醒）时才可能发出提醒，浏览器与系统的电池优化都会限制后台任务。」

5. 结论：**当前版本对用户可见的「提醒」是设置项 + 文案 + 权限按钮，不会真的产生一条到点的系统通知。** 这一点在 `README.md` 的「已知限制」里同样写着。

另外要讲清两条一般性事实：

- **Chrome for Android 的 Web Push 确实能在 App 未打开时送达**，但代价是你必须实现订阅端（`pushManager.subscribe`）、服务端订阅存储、VAPID 应用服务器与推送发送逻辑 —— 本仓库一个都没有。而且它推送的是**服务器主动发的消息**，本地定时提醒并不需要 push，但**准时唤醒 Service Worker 是不可靠的**：Doze、厂商电池优化、进程冻结都会推迟或丢弃，`setTimeout` 在页面被后台化后不保证执行。
- **Capacitor 不会把这件事变可靠。** 加了原生壳只是给 WebView 套了层容器；要让提醒到点，必须再引入原生本地通知/精确闹钟（例如 `@capacitor/local-notifications` 之类插件，配合 Android 12+ 的 `SCHEDULE_EXACT_ALARM`/`POST_NOTIFICATIONS` 权限）并自己处理厂商省电策略。**「打包成 APK」不等于「后台通知可靠」**，这是最常见的误解。

### 5.4 如果你要做原生壳：前置条件与步骤（未验证，在你的机器上执行）

**先决条件（本机全部缺失，见第 4 节）**

1. JDK 17 或 Android Studio 当前要求的版本（以 Android Gradle Plugin 官方兼容表为准；不要照抄网上的「JDK 8 也行」）。
2. Android SDK：platform-tools（`adb`）、与目标 compileSdk 匹配的 platforms、build-tools；并接受许可 `sdkmanager --licenses`。
3. 设置 `JAVA_HOME`、`ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）。
4. 真机或模拟器（`adb devices` 能看到设备）。

**一个必须先解决的技术前提**：Capacitor 需要一个**纯静态的前端目录**（`webDir`），而 Next.js 的生产产物要跑在 Node 上。本仓库的 `next.config.ts` **没有** `output` 字段（既不是 `export` 也不是 `standalone`），而且 `app/api/ai/analyze/route.ts` 的 POST 是依赖 `Request` 的 Route Handler —— Next 官方文档（`node_modules/next/dist/docs/01-app/02-guides/static-exports.md` 的 Unsupported Features）明确把它列为静态导出**不支持**的项。所以在动手打包前，你必须先三选一：

- **A. 静态导出 + 关掉 AI**：给 `next.config.ts` 加 `output: 'export'`，App 里 `/api/ai/*` 变成 404，`lib/ai/client.ts` 会走 `unreachable` 分支（文案「纯静态部署时属于预期」），AI 教练在 App 内不可用。**这条路本会话没有尝试，不确定当前代码能否直接构建成功。**
- **B. App 指向你的自托管地址**（Capacitor 的 `server.url`）：能用 AI，但那不是离线打包，且你要重新评估 HTTPS 证书锁定与「这还算不算原生 App」。
- **C. 保持 PWA，只做「可信源 + 原生通知」的最小壳**：需要自己加原生通知插件并解决 5.3 的可靠性问题。

**步骤（示例命令，未在此机器执行过，`@capacitor/*` 目前不是本仓库依赖）**

```bash
# 在你的机器上执行；本会话没有运行其中任何一条，也没有安装任何包
npm install @capacitor/core @capacitor/cli @capacitor/android

npx cap init "LogicDaily" "com.example.logicdaily" --web-dir=out
# 说明：--web-dir 只是示例值。走 A 路线时它应当是 next export 的输出目录
# （配了 output: 'export' 后 next build 的静态产物位置需要你按 Next 文档确认），
# 本仓库现在既没有 export 配置，也没有 out/ 目录，所以这一步现在必然要先改配置。

npm run build           # 或你为静态导出调整后的构建命令
npx cap add android
npx cap sync

# 用 Android Studio 打开 android/ 目录做真机调试与构建：
cd android && ./gradlew assembleDebug      # 本地测试包
cd android && ./gradlew bundleRelease      # 上架用的 AAB，需要你自己的 keystore
```

打包之后仍然要做、而 Capacitor **不会**替你做的事：

- 本地通知插件 + 精确闹钟权限 + 各厂商省电白名单引导（否则提醒照样不准）。
- 如果要推送：FCM（或厂商通道）+ 你的服务端，以及账号体系（当前用户没有账号）。
- 数据迁移：PWA 的站点数据在 Chrome 的 profile 里，Capacitor WebView 是**另一个存储域**。装了 APK 不会自动继承你「添加到主屏幕」那份训练记录。搬运办法只有仓库里已有的那条路：`我的` → 导出备份 JSON → 在新壳里导入（实测 `lib/db/store.ts:603-625` 校验结构与版本并要求 `app === 'logicdaily'`；`lib/domain/settings.ts:105-108` 只丢弃设置里 `ai` 段的 `apiKey`/`key`/`token`）。
- 签名 keystore 的保管、版本升级策略、商店素材与隐私声明。
- 上架分发（Google Play 的开发者账号与一次性注册费等以官方当前页面为准，我没有核实过）。
- AGPL-3.0-or-later：以 APK 形式分发同样要求随附/明示源码。

**我不会在这台机器上执行以上任何命令**，因为第 4 节的前提一个都不满足。如果你在自己机器上跑通了，欢迎把结果（含 Gradle/Capacitor 版本、compileSdk、静态导出到底怎么配成功的）补进这份文档 —— 那份更新才是验证过的。

## 6. 已知限制（手机端）

- 没有 APK，也没有任何签名包、商店页面；Capacitor / Gradle **从未尝试**（第 4 节有环境证据）。
- 后台提醒不可靠，且当前实现**没有**任何真正的通知发送代码：只有权限请求按钮；`decideReminder()` 无运行时调用点；无 Web Push（无 `PushSubscription`/`pushManager`）。
- 安全区变量 `env(safe-area-inset-*)` 已生效（meta viewport 含 `viewport-fit=cover`），同时仍有 `pb-28` + `min-h-[52px]` 这类固定补偿兜底。未在真机上量过刘海与手势区的实际像素值。
- `orientation: 'portrait-primary'` 只是 manifest 建议值，不构成横屏被禁止的保证。
- 离线行为没有 e2e 覆盖（测试里反而先注销 SW、清 cache），本文第 2 节是代码阅读结论，不是真机断网验证。
- 首次安装必须在联网状态下使用一次，之后离线能力才「攒够」；从未访问过的路由首次离线可能打不开。
- `/api/*` 永不缓存（设计如此）：AI 教练在离线时必然不可用。
- 若用非 HTTPS 地址访问（内网 IP、`http://` 域名），Service Worker 不注册，离线与安装都不可用。
- 用户数据只在浏览器 IndexedDB（数据库名 `logicdaily`）里：换浏览器、换设备、清除站点数据、系统清理存储都会丢；没有云端同步 —— 实测代码目录里没有任何读取 `SUPABASE_*` 的代码，也没有登录流程（`supabase/migrations/` 里有 SQL，装上也不会改变 App 的行为）。
- 没有为大屏/横屏做过适配验证；内容容器宽度上限 `max-w-[520px]`。
- 软键盘没有专门逻辑（无 `visualViewport` 监听），真机上的输入体验未测试；e2e 视口是 `devices['Pixel 7']`（实测 412×839），而用例标题写着 393×851，两者不一致。
- 本文所有真机表述（Chrome 菜单文案、厂商浏览器行为、Doze 影响）属于一般性说明，**没有**在任何 Android 设备上实测过。

## 7. 想在手机上认真验证一遍的话

按顺序做，每一步都能看到实际结果（这些是给你的机器的指令，我没有执行）：

1. `npm run build && npm start`，用内网 IP + HTTPS 暴露（或用你的正式域名）。**别用 `http://`**，否则第 2 步一定失败。
2. 手机 Chrome 打开 → 菜单确认有「安装应用/添加到主屏幕」。没有就查 `chrome://serviceworker-internals` 与 `/manifest.webmanifest` 是否 200。
3. 联网状态下把 `/`、`/train`、`/journal`、`/journal/new`、`/review`、`/stats`、`/me`、`/coach`、`/offline` 各点一遍（让分块进缓存）。
4. 关掉 Wi-Fi 与蜂窝数据，从桌面图标启动，做一道题、写一篇日志、看复习队列，确认能保存（重开一次仍在）。
5. 打开「我的」页看提醒区：会显示通知权限状态，可以点「请求通知权限」——授权后**不会**收到任何定时通知，这就是 5.3 说的现状。
6. 键盘/遮挡：在 `/journal/new` 点最长的输入框，观察键盘弹起后是否被底部导航盖住。
7. 想看 DOM/存储细节：手机开 USB 调试，桌面 Chrome 访问 `chrome://inspect`（这需要本机装 platform-tools/adb，即第 4 节缺失的那部分）。
8. 若第 6 步出现遮挡或溢出，请附上机型、Chrome 版本与截图开 Issue —— 那会是这份文档第一份真机证据。
