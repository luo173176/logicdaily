# LogicDaily 在 Android 上：现在能用成什么样

## 0. 结论先说

本仓库现在有**两条构建目标**，都在同一份源码上：

|              | Web / PWA（默认）                  | APK（`android/`，Capacitor 6）                                                         |
| ------------ | ---------------------------------- | -------------------------------------------------------------------------------------- |
| 构建方式     | `npm run build` + `npm start`      | `npm run build:apk-web` → `npx cap sync android` → Gradle                              |
| Next 配置    | `cacheComponents` + Route Handler  | `output: 'export'`，**不含** `app/api`                                                 |
| AI 思维教练  | 可用：服务端代理（默认）或本机直连 | 只有**本机直连**：没有 Node 服务端，代理通路必然不可用；用户自己填服务商地址与 API Key |
| 其余全部功能 | 离线可用                           | 离线可用（题库 112 题随包播种进 IndexedDB）                                            |
| 分发         | 你自己的 HTTPS 域名                | GitHub Releases 上的 debug 签名 APK                                                    |

- **APK 已经真实构建成功并有产物**：`android/app/build/outputs/apk/debug/app-debug.apk`，4,303,043 字节（4.10 MB），Gradle 首次完整构建 `BUILD SUCCESSFUL in 1m 29s`（82/82 tasks）。第 4 节贴了环境版本、构建命令与 `aapt2` 的真实输出。
- **走的是「纯离线单机」路线**：APK 从打包进自身的本地资源加载页面（`capacitor.config.ts` 里不设 `server.url`），因此不依赖任何服务器，也不需要 HTTPS 域名。代价是**服务端代理那条 AI 通路在 App 内不存在**；1.1 起可以改用**本机直连**（我的 → AI 教练 → 请求怎么走 → 本机直连），密钥与地址都存在这台设备上，代价见 `docs/AI_INTEGRATION.md` 3.6 与 `SECURITY.md` 2.7。
- **推荐用法仍然是 PWA**（第 1 节）：不需要签名、上架、升级策略，且两种 AI 通路都可用（服务端代理不需要用户自己持有 Key）。APK 的价值在于「不依赖浏览器站点数据清理策略」「可在没有 Chrome 的设备分发」，以及为将来的原生通知留出入口。
- **这是 debug 包，不是上架包**：用 Android 默认的 debug keystore 签名，只能直接安装到手机上侧载试用，不能提交 Google Play（那需要 `bundleRelease` + 你自己的 keystore，见 5.5）。
- **构建机上没有连接设备**（`adb devices` 为空），所以没有自动化真机测试；对 APK 的验证方式是**用 Playwright 驱动与打包进 APK 的那一份静态资源逐条核对功能**（`npm run verify:apk-web`，22 项全通过，其中包含在无 Node 服务端的情况下真的完成一次跨源直连调用）。第 6 节明确区分了「已验证」和「未验证」。
- **已有一条真机实测反馈**：使用者在自己的 Android 手机上装了 v1.0.0，发现「我的 → AI 教练」把 JSON 解析错误直接显示了出来。原因与修复见 4.6.1 —— 这条反馈本身证明 App 能在真机上安装、渲染、路由并读写 IndexedDB。

写这份文档时，本仓库同样从未部署过公网实例，部署相关见 `docs/DEPLOYMENT.md`。PWA 路线需要你先把它跑在一个 HTTPS 地址上（本机 `http://localhost` 只能用于同一台机器的调试，且 Service Worker 之外的手机访问不会是安全上下文）；APK 路线不需要。

## 1. 安装为 PWA：步骤与前提

### 1.1 前提（本仓库的实际配置）

Chrome 判定「可安装」需要的东西，逐条对照本仓库：

| 条件                               | 本仓库状态                                                                                                                                                                                                         | 依据（实测文件）                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| HTTPS（或 localhost）              | 由你的部署提供                                                                                                                                                                                                     | `components/service-worker-registration.tsx:13` 只在 `https:` 或 `localhost`/`127.0.0.1` 下注册 SW |
| `start_url` 可访问、在 `scope` 内  | `id`/`start_url` = `/`，`scope` = `/`                                                                                                                                                                              | `content/app-manifest.json`                                                                        |
| Web App Manifest 被链接            | `metadata.manifest = '/manifest.webmanifest'`，由 `app/manifest.ts`（`MetadataRoute.Manifest`）输出，数据取自 `content/app-manifest.json`；实测该 URL 返回 `content-type: application/manifest+json`               | `app/layout.tsx`                                                                                   |
| 图标 ≥192px 与 ≥512px，且 maskable | `/icons/icon-192.png`、`/icons/icon-512.png`、`/icons/icon-maskable-512.png`（purpose 分别为 `any`/`any`/`maskable`）；4 个 PNG 文件实测存在于 `public/icons/`                                                     | `content/app-manifest.json`、`public/icons/`                                                       |
| 已注册且能工作的 Service Worker    | `public/sw.js`，`scope: '/'`，`updateViaCache: 'none'`                                                                                                                                                             | `components/service-worker-registration.tsx:57`                                                    |
| 名称/显示模式                      | `name`、`short_name` = `LogicDaily`，`display: standalone`，`display_override: ['standalone','minimal-ui']`，`orientation: portrait-primary`，`background_color` `#f6f6f4`，`theme_color` `#2f5d88`，`lang: zh-CN` | `content/app-manifest.json:3,10-14`                                                                |
| 桌面长按菜单快捷方式               | 3 条：`/train`「开始今天的训练」、`/journal/new`「写思考日志」、`/review`「复习错题」                                                                                                                              | `content/app-manifest.json:21-25`                                                                  |

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

- **AI 思维教练**离线时不可用（教练页、日志的 AI 审阅、材料论证分析、题目推荐、周报）。原因不是「没缓存」，而是这条能力必须出网：代理模式要联网到本站 `/api/*` 再由服务端转发给模型，直连模式要联网到你自己填的服务商。离线时两者都不通，`lib/ai/client.ts` 在网络失败时返回 `code: 'network'`，界面文案是「无法连接模型服务」。
- 从未在联网状态下访问过的路由，第一次离线打开可能拿不到分块（回落顺序见上表）。
- 首次安装时（缓存还是空的）离线基本什么都做不了 —— 所以**装完先在联网状态下把主要页面点一遍**。

一句诚实的补充：**这套离线行为没有被端到端测试覆盖**。实测 `tests/e2e/*.spec.ts` 里没有任何 `context.setOffline()` 调用，`tests/e2e/data-and-ai.spec.ts` 的「AI 降级」用例反而先注销 SW 并清空 caches（`:104-113`）以便桩掉路由。上表是对 `sw.js` 的逐行阅读结论，不是真机断网验证结果。

## 3. 键盘、安全区与竖屏：CSS 里到底写了什么

### 3.1 视口与方向

- `content/app-manifest.json:12` 设了 `"orientation": "portrait-primary"`（Web 侧由 `app/manifest.ts` 作为 `MetadataRoute.Manifest` 输出，APK 侧由 `scripts/build-apk-web.mjs` 复制成 `public/manifest.webmanifest`，见 5.2）。这是 manifest 的**建议值**，浏览器/系统是否强制锁定不保证；不要把它当成「横屏被禁用」的既成事实。
- `app/layout.tsx` 的 `viewport` 导出：`width: 'device-width'`、`initialScale: 1`、`maximumScale: 5`、`viewportFit: 'cover'`，以及 `themeColor`（浅色 `#f6f6f4` / 深色 `#14161a`，按 `prefers-color-scheme` 分派）。在生产实例上实测拿到的 HTML 是：

```text
$ curl -s http://127.0.0.1:3123/ | grep -o '<meta name="viewport"[^>]*>'
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover"/>
```

`viewportFit` 这一项 Next 16 的类型是支持的（`node_modules/next/dist/lib/metadata/types/extra-types.d.ts:52`）。

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
- 这一条有测试但标题不准：`tests/e2e/data-and-ai.spec.ts:198` 的用例「长文本输入不会被底部导航遮挡」断言的是 `/journal/new` 第一个标注输入的 `y + height < viewport.height`；它只证明**没有键盘时**输入框在视口内，软键盘真正弹起后的表现仍然无法在 Playwright 里模拟。同一文件 `:183` 的用例标题曾写着「393×851」，而配置 `playwright.config.ts:20` 用的是 `devices['Pixel 7']`，实测该描述符（下面这段是真实输出）是 412×839，标题与断言不符 —— 现已把标题改成实际使用的描述符，数字以 412×839 为准。
- 本仓库的 e2e 是跑过的（`npx playwright test` → 22 passed，见 4.6），但**没有**跑在真机上，所以「键盘弹起不遮挡」仍属未验证。

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

## 4. 环境实测与真实构建记录

下面的命令全部是在这台 Windows + Git Bash 机器上真实执行的，输出原样粘贴（`iconv -f GBK -t UTF-8` 只用于还原中文乱码，不改变语义）。

### 4.1 工具链

JDK 与 Android SDK 装在 `D:\dev` 下，**都不在系统 PATH 上**，所以每条命令都要显式给出路径或 `JAVA_HOME`：

```text
$ ls -d /d/dev/*
/d/dev/android-sdk  /d/dev/jdk17  /d/dev/gradle-8.9  /d/dev/gradle-9.4.0  /d/dev/gradle-9.5.0  …

$ "D:/dev/jdk17/bin/java.exe" -version
openjdk version "17.0.20.1" 2026-08-18
OpenJDK Runtime Environment Temurin-17.0.20.1+1 (build 17.0.20.1+1)
OpenJDK 64-Bit Server VM Temurin-17.0.20.1+1 (build 17.0.20.1+1, mixed mode, sharing)

$ echo "[${JAVA_HOME:-unset}]"
[unset]

$ cd android && JAVA_HOME="D:/dev/jdk17" /d/dev/gradle-8.9/gradle-8.9/bin/gradle.bat --version
Gradle 8.9
Build time:    2024-07-11 14:37:41 UTC
Kotlin:        1.9.23
Launcher JVM:  17.0.20.1 (Eclipse Adoptium 17.0.20.1+1)
Daemon JVM:    D:\dev\jdk17 (no JDK specified, using current Java home)
OS:            Windows 10 10.0 amd64
```

SDK 目录内容：

```text
$ ls /d/dev/android-sdk
build-tools  cmake  cmdline-tools  licenses  ndk  platform-tools  platforms

$ ls /d/dev/android-sdk/platforms
android-34  android-35  android-36

$ ls /d/dev/android-sdk/build-tools
34.0.0  36.0.0
```

Capacitor 与依赖：

```text
$ npx cap --version
6.2.2

$ node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies))"
[ '@capacitor/android', '@capacitor/core', 'dexie', 'dexie-react-hooks', 'next', 'react', 'react-dom', 'zod' ]
# devDependencies 里另有 '@capacitor/cli'
```

版本选择是有原因的，不是随手挑的：

- **Capacitor 6.2.2 而不是 8.x**：Capacitor 8 生成的工程要求 `sourceCompatibility JavaVersion.VERSION_21` 与 compileSdk 36，而这台机器只有 JDK 17。6.2.2 的工程是 Java 17 / compileSdk 34，正好匹配。实测 `android/variables.gradle` 是 `minSdkVersion = 22`、`compileSdkVersion = 34`、`targetSdkVersion = 34`；`android/build.gradle` 是 `classpath 'com.android.tools.build:gradle:8.2.1'`（AGP 8.2.1）。
- **用本机 Gradle 8.9 而不是 wrapper**：`android/gradle/wrapper/gradle-wrapper.properties` 里写的是 `gradle-8.2.1-all.zip`，跑 `gradlew.bat` 会先联网下载 8.2.1 发行包。手上有 8.9，就直接用 `gradle.bat` 构建，避开一次无谓的大下载。**这只影响本机复现方式**：正常环境用 `./gradlew` 即可，仓库里没有对 wrapper 做任何改动。
- `android/local.properties` 写的是 `sdk.dir=D:/dev/android-sdk`。**必须用正斜杠**：写成 `sdk.dir=D\:\dev\android-sdk` 时 `:app:compileDebugJavaWithJavac` 会失败在 `SdkLocator$SdkLocationSource.validateSdkPath`，报 `java.io.IOException: 文件名、目录名或卷标语法不正确`（GBK 输出，原文如此）。这个文件在 `android/.gitignore` 里，每台机器自己生成。

### 4.2 构建命令（按顺序，每条都真实执行过）

```bash
npm run build:apk-web        # node scripts/build-apk-web.mjs → apk-web/（91 个文件，约 1.64 MB）
npx cap sync android         # 把 apk-web/ 复制进 android/app/src/main/assets/public
cd android
JAVA_HOME="D:/dev/jdk17" /d/dev/gradle-8.9/gradle-8.9/bin/gradle.bat clean assembleDebug
```

Gradle 真实输出（尾部）。第一次是完整构建：

```text
BUILD SUCCESSFUL in 1m 29s
82 actionable tasks: 82 executed
exit=0
```

之后又重建了两次，都是增量：换构建脚本的配置传递方式后 `BUILD SUCCESSFUL in 34s`（23 executed / 59 up-to-date），换掉启动器图标后 `BUILD SUCCESSFUL in 28s`（6 executed / 76 up-to-date），最后 `clean assembleDebug` 完整重建 `BUILD SUCCESSFUL in 15s`（76 executed / 10 up-to-date）。四次 exit 都是 0。

产物（当前仓库里这一次的输出）：

```text
$ ls -la android/app/build/outputs/apk/debug/
-rw-r--r-- 1 luo17 197609 4303043 Oct 10 09:24 app-debug.apk
-rw-r--r-- 1 luo17 197609     368 Oct 10 09:24 output-metadata.json

$ certutil -hashfile android/app/build/outputs/apk/debug/app-debug.apk MD5
a0ed509159b65dd02d244df085a0d133
```

4,303,043 字节 ≈ 4.10 MB。

一个踩过的坑：**把 gradle 的输出管道给 `tail` 会让 `$?` 变成 `tail` 的退出码**，第一次构建失败时我因此误判成成功。之后改成先重定向到文件再读，才拿到真实的 `exit=1` 和失败任务名。

### 4.2.1 启动器图标与闪屏

`npx cap add android` 生成的工程带的是 Capacitor 模板自带的 logo —— 直接发布会让 App 在手机上显示别人的图标。`scripts/generate-icons.mjs` 现在在生成 PWA 图标之后，若检测到 `android/app/src/main/res` 存在，就用同一套图案覆写 25 个 PNG：

- `mipmap-{m,h,x,xx,xxx}hdpi/ic_launcher.png`：圆角方块版（48/72/96/144/192）。
- `mipmap-*/ic_launcher_round.png`：圆形裁切版。
- `mipmap-*/ic_launcher_foreground.png`：adaptive icon 的前景层，满幅铺品牌色、图案收在 108dp 画布的 72dp 可信区内（`ringOuter = 0.30 × 短边`），这样启动器裁成圆形或方形时成品与 PWA 图标一致。
- `drawable-port-*` / `drawable-land-*` 的 `splash.png`：品牌渐变底 + 居中标记。
- `values/ic_launcher_background.xml`：背景色层改成 `#2F5D88`，避免与前景接缝。

脚本是纯 Node（zlib + 手写 CRC32），没有引入任何图像处理依赖；重构后 PWA 那 4 个 PNG 的输出与之前**逐字节相同**（`md5sum -c` 验证）。

### 4.2.2 增量打包会留下死空间：发布前请 clean

第一次上传 Release 用的是增量构建的 APK，4,732,472 字节。后来在一份干净克隆里重建，得到 4,302,821 字节 —— 差了近 430 KB。逐条目比对两个包：**条目数完全相同（578），每条目的压缩后数据也几乎相同（差 223 字节，来自 CSS chunk 名里的构建 id）**，差的根本不是内容。

用 zip 本地头逐个算条目间空隙才看清：增量包里有 11 个条目后面垫了共 **429,429 字节**的死空间（最大一段 348,627 字节紧跟在 `res/xml/file_paths.xml` 之后），干净构建的包是 **0**。AGP 的增量打包在条目变小时会把旧位置留成空洞，不会自动回收。

结论与做法：

- **发布用的包必须来自 `gradle clean assembleDebug`**，不是增量产物。本文与 Release 上的字节数/MD5 对应的就是 clean 之后的那一次。
- 别把包体大小当成回归指标去追增量构建的数字，它会被打包器的空洞污染。
- 想核对两个包是否等价，比条目清单与逐条目压缩大小，而不是比文件总大小。

### 4.3 用 aapt2 核验 APK 元数据

```text
$ /d/dev/android-sdk/build-tools/34.0.0/aapt2.exe dump badging android/app/build/outputs/apk/debug/app-debug.apk
package: name='com.logicdaily.app' versionCode='1' versionName='1.0' platformBuildVersionName='14' platformBuildVersionCode='34' compileSdkVersion='34' compileSdkVersionCodename='14'
sdkVersion:'22'
targetSdkVersion:'34'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='com.logicdaily.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
application-label:'LogicDaily'
application: label='LogicDaily' icon='res/mipmap-anydpi-v26/ic_launcher.xml'
launchable-activity: name='com.logicdaily.app.MainActivity'  label='LogicDaily' icon=''
```

对照 `capacitor.config.ts` 实测内容：`appId: 'com.logicdaily.app'`、`appName: 'LogicDaily'`、`webDir: 'apk-web'`、`backgroundColor: '#f6f6f4'`、`android.allowMixedContent: false`、`server.androidScheme: 'https'`，并且**没有 `server.url`** —— 这正是「从 APK 内的本地资源加载」的开关；一旦设了 `server.url`，WebView 就变成指向你服务器的远程壳，离线特性全丢。

### 4.4 核验 APK 里到底装了什么

```text
$ /d/dev/jdk17/bin/jar.exe tf android/app/build/outputs/apk/debug/app-debug.apk | grep -c "^assets/public"
93

# 与打包前的 apk-web/ 逐个路径比对
$ … | sed -n 's|^assets/public/||p' | sort > /tmp/apk-list.txt
$ (cd apk-web && find . -type f | sed 's|^\./||' | sort) > /tmp/src-list.txt
$ comm -13 /tmp/apk-list.txt /tmp/src-list.txt   # 在 apk-web 但没进 APK 的：空
$ comm -23 /tmp/apk-list.txt /tmp/src-list.txt   # APK 多出来的：
cordova.js
cordova_plugins.js
```

即 **`apk-web/` 的 91 个文件一个不少地全在 APK 里**，另加 Capacitor 注入的 2 个桥接文件。APK 根下还有 `assets/capacitor.config.json`、`assets/capacitor.plugins.json`、`assets/native-bridge.js`（这三个不属于 `assets/public/`）。

**这一步是必要的**：它证明「被验证过的那份资源」和「打进包里的资源」是同一份，否则 4.6 的功能验证都不算数。

### 4.5 没有真机：`adb devices` 是空的

```text
$ /d/dev/android-sdk/platform-tools/adb.exe devices
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
（下面无内容）
```

所以：**APK 构建成功、包内资源逐文件核对通过，但这台构建机上没有连接任何设备，因此没有自动化的真机测试**（使用者自己装机跑过一次，见 4.6.1）。4.6 的 22 项验证针对的是打进 APK 的那份静态资源本身（Playwright，`devices['Pixel 7']` → 实测 412×839），它能覆盖业务逻辑与布局，但**覆盖不到原生层**：WebView 内核版本差异、`https://localhost` 下的 IndexedDB 配额与清理策略、返回键行为、启动闪屏、系统深色模式联动、通知权限弹窗 —— 这些在第 6 节一律标注为未验证。

### 4.6 对打进 APK 的那份资源的功能验证

```text
$ node scripts/verify-apk-web.mjs
…
22/22 通过
```

完整清单（全部 PASS）：

| #      | 检查项                                                     | 说明                                                             |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| 1      | 首页加载并出现引导                                         | 静态包在没有 Node 服务的情况下能渲染并读到本机数据               |
| 2      | 离线包内题库已播种（112 题）— 实际 112                     | 直接对 IndexedDB 的 `exercises` 表 `count()`，确认题库随包可用   |
| 3      | 深链接进入题目                                             | `/train/?exercise=ex-cond-001` 冷启动可用                        |
| 4      | 提交并判分                                                 | 选择选项 → 提交 → 出现判分结果                                   |
| 5      | `/me/` AI 优雅降级                                         | 「我的 → AI 教练」必须给出可读说明，见 4.6.1                     |
| 6      | `/coach/` AI 优雅降级                                      | 教练面板同理；两条都断言页面里不出现解析器文案                   |
| 7      | 包内设置页出现直连选项                                     | 「本机直连」入口在纯离线包里存在                                 |
| 8      | 包内直连完成一次跨源调用                                   | 设置里点「测试连接」，界面出现服务商返回的 `pong`                |
| 9      | 直连请求带上 Bearer 且只发给填写的地址                     | 桩服务商断言 `Authorization: Bearer …` 与 `/v1/chat/completions` |
| 10     | 直连设置已保存                                             | 教练页读已保存的设置而不是草稿                                   |
| 11     | 直连填齐后教练按钮可用                                     | 4.6.2 修的那个「按钮永远点不动」现在有断言盯着                   |
| 12     | 包内教练页用直连拿到结构化分析                             | 材料分析走完整链路并把结果渲染出来                               |
| 13     | 导出的备份文件里既没有密钥也没有密钥字段                   | 真的下载一次备份文件并搜那串 Key                                 |
| 14     | 保存后 URL 变为 `/journal?edit=<id>`                       | 见 5.4 的路由说明                                                |
| 15     | 冷启动到 `?edit=` 深链接后内容仍在                         | 刷新后编辑器仍是同一篇                                           |
| 16     | 列表可见该篇日志                                           | 写进去的数据能被读出来                                           |
| 17     | 从列表点进编辑器                                           | 列表 → 编辑器的入口                                              |
| 18～22 | `/review/` `/stats/` `/me/` `/train/` `/coach/` 无横向溢出 | 5 条路由，实测溢出 0px                                           |

（第 5/6 项各是一页，第 18～22 项是 5 条路由，合计 22 项断言。）

第 7～13 项需要「另一台服务器」才测得出直连：脚本除了 4321 上的静态资源，还在 **4322 端口起一个假的 OpenAI 兼容服务商**，
于是包内页面发出的是一次真实的跨源请求（带预检）。它证明的是这条通路在没有 Node 服务端的构建里能走完，
**不证明**任何真实服务商接受你的 Key。

脚本自己起静态 HTTP 服务器（端口 4321）托管 `apk-web/`，用 Playwright 打开，跑完即关。**它测的是资源目录，不是安装后的 App。**

Web 主线的回归也重跑过，APK 这条改动没有破坏它：

```text
$ npx playwright test
22 passed
exit=0
```

单元与集成测试规模见 `README.md`（235 项）。

### 4.6.1 第一条真机反馈：降级文案漏出了 JSON 解析错误

使用者在自己的 Android 手机上装了 v1.0.0，打开「我的 → AI 教练」看到：

> 无法连接 AI 服务
> Unexpected token '<', "<!DOCTYPE "... is not valid JSON

这不是配置问题，是**降级路径本身写错了**，而且原因很具体：

1. Capacitor 的 `WebViewLocalServer` 默认 `html5mode = true`（`CapConfig.java:36`，本仓库没有覆盖 `server.html5mode`）；
2. 于是任何「最后一段不含点」的路径都会被兜底成应用自己的 `index.html` 并返回 **200**（`WebViewLocalServer.java:401`）—— `/api/ai/status` 正好落进这条分支；
3. `lib/ai/client.ts` 原来只在 `!response.ok` 时判定不可达，200 + HTML 会走到 `response.json()` 抛 `SyntaxError`，而 catch 分支把 `error.message` 原样显示给了用户。

修复分三处：`readAiStatus()` 先按内容类型判定，拿到 HTML 就返回设计好的说明（`NO_SERVER_MESSAGE`）；`callTask()` 同样区分「没有服务端」与「模型返回结构不对」，不再把前者说成后者；教练面板的标题在不可达时改成「这里连不上 AI 接口」。

**并且把测试台改成真的像 APK**：`scripts/verify-apk-web.mjs` 的静态服务器原先对未知路径返回 404，恰好绕过了这个 bug —— 现在它复刻 html5mode 兜底（无扩展名路径 → 200 + `index.html`），并新增两条断言：`/me/` 与 `/coach/` 页面必须出现可读的降级说明、且不得出现 `Unexpected token` / `is not valid JSON` / `SyntaxError`。`tests/unit/ai-client.test.ts` 也补了 9 个用例直接盯这几种响应形态。

这条反馈同时说明：本文此前「APK 从未在真机上运行过」的表述只描述了**构建机**的状态（`adb devices` 为空，所以没有自动化真机测试），不等于没人装过。IndexedDB 在 WebView 里能正常落盘、页面能渲染、路由能跳转，现在都有了真机侧的间接证据；仍然没有真机证据的是闪屏、返回键、通知权限与存储配额这些原生行为。

### 4.6.2 第二条真机反馈：App 里根本没法配 AI，于是加了本机直连

同一次装机之后的下一句反馈是：**「AI 教练配置不了啊，API key 呢，还有不是只能有这几个供应商，最好可以自定义添加 base_url」**。这条批评是成立的，而且暴露的不是 bug 而是能力缺口：v1.0.0 的界面里只有一个「提供商」下拉框和一个只用于展示的 `baseUrlLabel`，既没有地方填 Key，也没有地方填地址 —— 因为在有服务端的部署里这两样本来就不该由浏览器持有。纯离线包把那条前提作废了：没有 Node 服务端，代理通路不存在，于是 App 里的 AI 永远是「不可用」。

按使用者选定的方案，1.1 增加**本机直连**模式（`ai.mode = 'direct'`）：

- 地址与模型名改成自由填写，8 个预设降级为快捷方式（点一下填入，之后可改）。
- Key 存在这台设备的 `localStorage`（`lib/ai/credentials.ts`）。刻意不进 `settings` 记录：`migrateSettings()` 每次加载都会删掉 `apiKey`/`key`/`token`，而 `settings` 是导出备份的一部分 —— 放在记录里既会被自己抹掉，也会被带进备份。
- 出站前强制 https（回环除外）、URL 不带凭据、`redirect: 'error'`；提示词、输入上限、输出契约与代理模式同一份（`lib/ai/tasks.ts`）。
- 界面把代价写在明面上：明文在设备上、不进备份、没有服务端配额与审计、需要服务商允许跨域（实测 DeepSeek、Kimi、通义、StepFun、SiliconFlow 可以，智谱不行）。

**顺手修掉的连带 bug**：教练面板与材料分析页用本站 `/api/ai/status` 的结果决定是否可点，而直连模式下这个接口不存在 —— 结果是地址、模型、Key 全填对了按钮仍然点不动，这正是「配置不了」的第二层含义。就绪判断改为按模式分流（`directReadiness()`），并补了断言：包内第 11 项「直连填齐后教练按钮可用」。

包内的直连通路是真的跑过一遍的（4.6 表第 7～13 项）：脚本在 4322 端口起一个假的 OpenAI 兼容服务商，包内页面发出跨源请求、带预检、拿到结构化回复并渲染出来，同时断言导出的备份里搜不到那串 Key。**仍未验证**：任何真实服务商的真实 Key（也就没有真实的计费请求）、以及真机上 WebView 对 `localStorage` 的持久性表现。另有一条来自清单与系统默认行为的限制值得提前知道：`android/app/src/main/AndroidManifest.xml` 没有声明 `usesCleartextTraffic`，targetSdk 34 下 Android 默认禁止明文流量，所以局域网自建模型服务（`http://192.168.x.x:11434` 这类）在 App 里需要 https 反向代理 —— 直连的地址检查本来也只放行回环 http。

### 4.7 从已发布的仓库重新走一遍（干净副本）

上面所有命令都在一份**从 GitHub 下载的 tarball** 里重跑过一次，用来确认提交里没有漏掉构建必需的文件、也没有依赖我本地留下的产物：

```text
$ gh api repos/luo173176/logicdaily/tarball/main | tar xz --strip-components=1
$ ls -d apk-web .apk-src android/local.properties android/app/src/main/assets/public
ls: cannot access 'apk-web': No such file or directory          # 四个都不存在，说明副本是干净的
$ npm ci --no-audit --no-fund
added 491 packages in 60s
$ npm run build:apk-web
[4/4] 完成：apk-web/ 共 91 个文件，1.64 MB
$ npx cap sync android
[info] Sync finished in 0.311s
$ printf 'sdk.dir=D:/dev/android-sdk\n' > android/local.properties    # 这个文件不入库，每台机器自己写
$ cd android && JAVA_HOME="D:/dev/jdk17" gradle.bat assembleDebug
BUILD SUCCESSFUL in 34s
82 actionable tasks: 82 executed
```

副本产出的包 4,302,821 字节，与 `README`/本文引用的 4,303,043 字节差 222 字节 —— 差异全部来自 Next 构建 id 参与 chunk 文件名，属于每次构建都会变的量。**不要**把字节数当成可复现性断言，要看的是条目清单（两边都是 578 条、`assets/public` 都是 93 条）与 `aapt2` 元数据（`com.logicdaily.app` 1.0 / versionCode 1 / minSdk 22 / target 34），这两项在副本与本机完全一致。

顺带确认了 `capacitor.config.ts`、`content/app-manifest.json`、`android/variables.gradle`、`android/app/src/main/AndroidManifest.xml` 都已入库，而 `.apk-src/`、`apk-web/`、`android/local.properties`、`android/app/src/main/assets/public` 都没有被误提交。

## 5. APK 是怎么做到的：三个必须绕开的限制

这一节解释 4.2 那些命令背后的设计决策。要改这套流程，先知道为什么长这样。

### 5.1 静态导出与 `cacheComponents` 互斥

`next.config.ts` 在 Web 侧用 `cacheComponents: true`（本项目的性能特性），而 `output: 'export'` 要求每条路由都能静态化，两者冲突：导出器抱怨路由没有声明 force-static，而 `cacheComponents` 又拒绝任何 `export const dynamic` 配置。同时 Next 16 的 `next build` **没有** `-c/--config-file` 参数，无法在同一目录用第二份配置文件构建。

解决办法是**同一份源码、两个构建目标**，`next.config.ts` 按环境变量切换：

```ts
const isStaticExport = process.env.BUILD_TARGET === 'capacitor';
const nextConfig: NextConfig = {
  ...(isStaticExport
    ? { output: 'export' as const, trailingSlash: true, images: { unoptimized: true } }
    : { cacheComponents: true, partialPrefetching: true }),
  turbopack: { rules: { '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' } } },
};
```

CSS 规则两边都必须有，否则副本里 Tailwind 不生效。导出时由 `scripts/build-apk-web.mjs` 在 `execFileSync` 的 `env` 里传入 `BUILD_TARGET: 'capacitor'`，配置本身只有 `next.config.ts` 这一处，不存在第二份会漂移的副本配置。

### 5.2 为什么需要 `.apk-src/` 副本而不是原地导出

APK 里不存在 Node 服务端，`app/api` 下的 Route Handler 在导出模式下必然报错（依赖 `Request` 的 Route Handler 是 Next 官方文档列出的静态导出不支持项）。但**这些路由是安全边界**：SSRF 防护、API Key 只留在服务端、限流与每日配额都在里面，仓库里绝不能为了打包而删掉它们。删掉的只是副本里的这一份，所以包内**代理模式**必然不可用；包内可用的是另一条由使用者显式开启的**本机直连**通路（`lib/ai/direct.ts`，密钥在这台设备上，没有服务端配额与审计，见 4.6.2）。

所以 `scripts/build-apk-web.mjs` 走非破坏性路线：把源码递归复制进 `.apk-src/`，**只在副本里**排除 `app/api` 与 `app/manifest.ts`，然后在副本中构建。仓库本体一行不动，`.apk-src/` 与 `apk-web/` 都写进了 `.gitignore`，是可再生产物。

两个实现细节，都是踩出来的：

- 副本必须留在仓库**内部**，才能沿目录树向上解析到 `node_modules`；而 `fs.cpSync` 拒绝把目录复制进自身的子目录（`Cannot copy ... to a subdirectory of self`）。因此脚本里是手写的递归 `copyTree`。
- 副本里 `app/manifest.ts` 属于元数据路由，导出模式下报同一个错。因此把 manifest 数据抽成 `content/app-manifest.json` 单一来源：Web 侧 `app/manifest.ts` 读它并返回 `MetadataRoute.Manifest`，导出侧把它原样复制成 `public/manifest.webmanifest`。两边内容不会漂移。

### 5.3 `/manifest.webmanifest` 与 Service Worker 在 APK 里

`apk-web/` 里确实带着 `sw.js`（它在那 91 个文件中）。Capacitor 的 `androidScheme: 'https'` 让页面运行在 `https://localhost` 这个安全上下文里，所以 Service Worker **会**注册。这不影响正确性：`sw.js` 对 `/api/*` 直接放行（不缓存、不拦截），而 APK 里本来就没有 `/api/*`，那些请求会失败并被客户端的降级逻辑接住 —— 4.6 第 5 项测的就是这条路径。

### 5.4 为什么思考日志改成了 `/journal?edit=<id>`

动态段 `app/journal/[id]/page.tsx` 在静态导出下必须有**非空**的 `generateStaticParams()`，而日志 id 是用户在本机创建的，构建期不可能枚举。所以把「编辑器」从路径段改成查询参数：

```tsx
export function JournalScreen() {
  const params = useSearchParams();
  const editId = params.get('edit');
  return editId ? <JournalEditorView journalId={editId} /> : <JournalListView />;
}
```

`app/journal/page.tsx` 用 `<Suspense>` 包住它（`useSearchParams` 在导出模式下要求 Suspense 边界）。列表项、保存后的跳转、首页入口都改成 `/journal?edit=${id}`；Web E2E 用例同步更新，并新增「从列表点进编辑器 + 刷新后仍在同一篇」两步断言（4.6 末尾的 22 passed 包含它们）。

代价要讲明白：**日志不再有 `/journal/<id>` 这种天然可分享的短链接**。Web 侧同样走这个路由，所以是全局改变，不是 APK 专属的退化；而对本仓库「数据只在本机 IndexedDB、没有云端共享」的定位来说，分享链接本来就不成立，真正可用的搬运路径是导出备份 JSON。

### 5.5 打成上架包还差什么

本仓库只做到 `assembleDebug`，产物是 debug 签名。要走 release：

```bash
cd android
keytool -genkey -v -keystore logicdaily-release.keystore -alias logicdaily -keyalg RSA -keysize 2048 -validity 10000
# keystore 路径与口令配进环境变量或 ~/.gradle/gradle.properties，不要写进仓库
./gradlew bundleRelease
```

需要你自己负责：keystore 保管（丢了就无法给老用户升级）、`versionCode`/`versionName` 递增策略、Google Play 开发者账号与合规声明、以及 AGPL-3.0-or-later 下随附源码的义务。**这些步骤我没有执行过，本节不构成「照做就能上架」的承诺。**

打包之后仍然要做、而 Capacitor **不会**替你做的事：

- 本地通知插件 + 精确闹钟权限 + 各厂商省电白名单引导（否则提醒照样不准，见第 5.6 节）。
- 如果要推送：FCM（或厂商通道）+ 你的服务端，以及账号体系（当前没有账号）。
- 数据迁移：PWA 的站点数据在 Chrome 的 profile 里，Capacitor WebView 是**另一个存储域**。装了 APK 不会自动继承你「添加到主屏幕」那份训练记录。唯一的搬运办法是仓库里已有的那条路：`我的` → 导出备份 JSON → 在新壳里导入（实测 `lib/db/store.ts` 的导入校验结构与版本并要求 `app === 'logicdaily'`；设置导入只丢弃 `ai` 段里的 `apiKey`/`key`/`token`；直连模式的密钥根本不在备份里（它存在 `localStorage`），所以换到 APK 之后需要重新填一次 Key）。

### 5.6 通知与推送的真实状态（本仓库）

这是最容易误判的一块，逐条摆事实。检索范围限定代码目录（`app lib components features scripts tests public content`），以免被 Markdown 文档自身的叙述污染：

```text
$ grep -rn "PushSubscription\|pushManager" app lib components features scripts tests public content
（无输出，exit=1）

$ grep -rn "decideReminder" app lib components features
lib/services/reminders.ts:37:export function decideReminder(options: {
components/reminder-gate.tsx:7:import { decideReminder } from '@/lib/services/reminders';
components/reminder-gate.tsx:40:      const decision = decideReminder({
```

1. **没有 Web Push。** `PushSubscription`、`pushManager` 零命中；`public/sw.js` 里没有 `push`/`notification` 事件监听器（实测全文只有 `install`、`activate`、`fetch`、`message` 四个）。没有订阅、没有 VAPID 应用服务器密钥、没有保存订阅的服务端接口。因此**关掉 App、关掉网页之后，没有任何机制能把 LogicDaily 唤醒并通知你**。
2. **前台提醒已经接线（这一条是后来补的，之前是断的）。** `components/reminder-gate.tsx` 挂在 `app/layout.tsx` 的 `AppProviders` 内，应用打开时读 `store.getPlan` / `getProgress` / `listDueReviews` 算出待办必做项数与逾期天数，交给 `decideReminder()`，然后把结果表达为：页内横幅（`role="status"`，浮在底部导航之上）+ `notify()` + 在 `Notification.permission === 'granted'` 时构造 `new Notification(...)`。每天最多表达一次，用 `localStorage` 的 `logicdaily:reminder-fired:<dateKey>` 记录；`new Notification` 包了 try/catch，某些浏览器要求先有用户手势，弹不出来时页内横幅仍在。此前 `decideReminder()` 只有单元测试在用、运行时零调用点 —— 也就是设置项和文案都写了但什么都不发生，现在这条死链路接上了。
3. **决策逻辑本身是纯函数**（`lib/services/reminders.ts`）：开关/暂停、今天已提醒过、休息日不打扰、未到点、超过窗口不再打扰、免打扰时段（支持跨午夜 22:30–07:30 这类区间）、每周复盘日、待办数与逾期优先。由 `tests/unit/reminders.test.ts` 覆盖。
4. 该文件的注释仍是官方口径：

   > PWA 无法保证后台准时唤醒（浏览器与系统都会限制），因此这里只做「应用处于打开状态时的当日提醒」。真正的可靠后台提醒需要原生包装层。

   界面上也照这个说了（`features/me/me-view.tsx`）：「作为网页应用，只有页面开着（或 Service Worker 被系统唤醒）时才可能发出提醒，浏览器与系统的电池优化都会限制后台任务。」

5. 结论：**当前版本的「提醒」是「打开应用时才表达的当日提醒」；在你没打开它的时候，不会有到点的系统通知送达。** APK 也一样 —— 5.5 说的本地通知插件还没引入，Capacitor 壳本身不提供这个能力。

两条一般性事实：

- **Chrome for Android 的 Web Push 确实能在 App 未打开时送达**，代价是要实现订阅端（`pushManager.subscribe`）、服务端订阅存储、VAPID 应用服务器与发送逻辑 —— 本仓库一个都没有。而且它推的是**服务器主动发的消息**；本地定时提醒并不需要 push，但**准时唤醒 Service Worker 是不可靠的**：Doze、厂商电池优化、进程冻结都会推迟或丢弃，页面后台化后 `setTimeout` 不保证执行。
- **Capacitor 不会把这件事变可靠。** 原生壳只是给 WebView 套了层容器；要让提醒到点，必须再引入原生本地通知/精确闹钟插件，配合 Android 12+ 的 `SCHEDULE_EXACT_ALARM`、Android 13+ 的 `POST_NOTIFICATIONS`，并自己处理厂商省电策略。**「打包成 APK」不等于「后台通知可靠」**，这是最常见的误解。

## 6. 已知限制（手机端）

**APK 侧 —— 已验证的部分：**

- 有可安装的 debug APK（4,303,043 字节，`com.logicdaily.app` 1.0 / versionCode 1，minSdk 22 / target 34 / compileSdk 34），Gradle 首次完整构建 `BUILD SUCCESSFUL in 1m 29s`（第 4 节有全部命令与原始输出）。
- APK 内 93 个 `assets/public/*` 条目与打包前的 `apk-web/` 逐路径一致（4.4）。
- 打进包的那份资源经 Playwright 验证 22/22 通过：题库 112 题随包播种、答题判分、`/journal?edit=` 全流程含冷启动刷新、AI 优雅降级、无 Node 服务端时的本机直连（含跨源调用与「备份里没有密钥」）、5 条路由无横向溢出（4.6）。
- APK 是**纯离线单机**：不依赖任何服务器。包内没有 Node 服务端，因此**服务端代理**那条 AI 通路不可用（界面给出说明而非崩溃）；**本机直连**可用，已在包内验证过一次真实的跨源调用（4.6 表第 7～13 项），代价见 4.6.2。

**APK 侧 —— 未验证 / 明确不具备：**

- **构建机上没有设备**（`adb devices` 为空，4.5），所以没有自动化真机测试。已知的真机事实只有一条：使用者在 Android 手机上装 v1.0.0 后 App 能打开、能进「我的」页（那次反馈见 4.6.1）。仍然没有证据的原生行为：WebView 内核版本差异、IndexedDB 配额与系统清理策略、返回键、启动闪屏、系统深色模式联动、通知权限弹窗。
- **debug 签名，不能上架**。没有 release keystore、没有 AAB、没有商店页面；5.5 的 release 步骤未执行。
- **APK 里没有后台提醒能力**。没有 Web Push（`PushSubscription`/`pushManager` 零命中），没有原生本地通知插件；`ReminderGate` 只在页面打开时表达当日提醒（5.6）。
- APK 里的 AI 只有直连这一条通路，而**直连从未用真实 Key 打过真实服务商**：包内验证用的是本地起的假服务商，只证明通路形状正确。真实计费调用、真实 CORS 行为、WebView 对 `localStorage` 的持久性都还没有真机证据。若要用服务端代理，走 PWA 路线或 `server.url` 远程壳（后者会失去离线）。
- APK 与 PWA 的存储**不互通**：装了 APK 不会继承「添加到主屏幕」那份记录，只能导出 JSON 再导入。
- `orientation: 'portrait-primary'` 只是 manifest 建议值；APK 侧没有额外做原生方向锁定配置。
- 没有为大屏/横屏做过适配验证；内容容器宽度上限 `max-w-[520px]`。
- AGPL-3.0-or-later：以 APK 形式分发同样要求随附/明示源码。

**PWA 侧：**

- 后台提醒不可靠：只有「打开时」的当日提醒（页内横幅 + 已授权时的 `new Notification`），没有到点的系统级唤醒（5.6）。
- 安全区变量 `env(safe-area-inset-*)` 已生效（meta viewport 含 `viewport-fit=cover`），同时仍有 `pb-28` + `min-h-[52px]` 这类固定补偿兜底。未在真机上量过刘海与手势区的实际像素值。
- 离线行为没有 e2e 覆盖（测试里反而先注销 SW、清 cache），第 2 节是对 `public/sw.js` 的逐行阅读结论，不是真机断网验证。
- 首次安装必须在联网状态下使用一次，之后离线能力才「攒够」；从未访问过的路由首次离线可能打不开。
- `/api/*` 永不缓存（设计如此）：AI 教练离线时必然不可用。
- 若用非 HTTPS 地址访问（内网 IP、`http://` 域名），Service Worker 不注册，离线与安装都不可用。
- 用户数据只在浏览器 IndexedDB（数据库名 `logicdaily`）里：换浏览器、换设备、清除站点数据、系统清理存储都会丢；没有云端同步，也没有登录流程（`supabase/migrations/` 里有 SQL，装上也不会改变 App 的行为）。
- 软键盘没有专门逻辑（无 `visualViewport` 监听），真机上的输入体验未测试。
- 本文关于真机的表述（Chrome 菜单文案、厂商浏览器行为、Doze 影响）属于一般性说明，**没有**在任何 Android 设备上实测过。

## 7. 想在真机上认真验证一遍的话

**跑现成的 APK**（不需要 Node 环境，在你的手机上执行）：

1. 从本仓库的 GitHub Releases 下载 debug APK，安装（需要允许「未知来源」）。
2. 首次打开不需要联网（题库在包里）。做一道题、写一篇日志、刷新页面确认数据还在，就验证了 IndexedDB 在这个 WebView 里真的能落盘 —— 这是 4.5 里唯一没能自动覆盖的点。
3. 「我的」页看提醒区，授权通知后回到应用内，确认当日提醒是否以系统通知形式出现（当前设计只在打开时表达，见 5.6）。
4. 想和 PWA 数据打通：在 PWA 里 `我的` → 导出备份 JSON，在 APK 里导入。

**自己从源码构建 APK**（在你的机器上执行）：

1. 准备 JDK 17+（版本要与所选 Capacitor/AGP 匹配 —— 见 4.1 关于 Capacitor 8 需要 JDK 21 的说明）、Android SDK（platform-tools + 与 compileSdk 匹配的 platforms/build-tools，并接受 `sdkmanager --licenses`）。
2. `npm install` → `npm run build:apk-web` → `npx cap sync android`。
3. 在 `android/local.properties` 写 `sdk.dir=`，**用正斜杠**（4.1）。
4. `cd android && ./gradlew clean assembleDebug`（要发布就带上 `clean`，见 4.2.2）。
5. `adb install -r app/build/outputs/apk/debug/app-debug.apk`（`adb devices` 必须先能看到设备）。

**PWA 路线的验证步骤**：

1. `npm run build && npm start`，用内网 IP + HTTPS 暴露（或用你的正式域名）。**别用 `http://`**，否则第 2 步一定失败。
2. 手机 Chrome 打开 → 菜单确认有「安装应用/添加到主屏幕」。没有就查 `chrome://serviceworker-internals` 与 `/manifest.webmanifest` 是否 200。
3. 联网状态下把 `/`、`/train`、`/journal`、`/journal/new`、`/review`、`/stats`、`/me`、`/coach`、`/offline` 各点一遍（让分块进缓存）。
4. 关掉 Wi-Fi 与蜂窝数据，从桌面图标启动，做一道题、写一篇日志、看复习队列，确认能保存（重开一次仍在）。
5. 键盘/遮挡：在 `/journal/new` 点最长的输入框，观察键盘弹起后是否被底部导航盖住。
6. 想看 DOM/存储细节：手机开 USB 调试，桌面 Chrome 访问 `chrome://inspect`。
7. 若第 5 步出现遮挡或溢出，请附上机型、Chrome 版本与截图开 Issue —— 那会是这份文档第一份真机证据。

如果你在自己机器上跑通了 release 打包或真机验证，欢迎把结果（Gradle/Capacitor/AGP 版本、compileSdk、机型与系统版本、实际现象）补进本文档 —— 那份更新才算验证过的。
