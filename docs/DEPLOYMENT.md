# 部署 LogicDaily

本文说明如何把这个 Next.js 应用部署到公网，以及上线前必须由运维（可能就是你自己）完成的检查项。

## 0. 先说清楚：什么是验证过的，什么不是

本仓库**从未部署到任何环境**。本文里的部署步骤是**说明**，不是验证结论。

区分方式：

- 标注「实测」的代码块，是本会话在这台 Windows 机器（仓库目录 `E:\Users\luo17\AppData\Programs\Qoder\logicdaily`）里真实执行过的只读命令，输出原样粘贴，未作修改。
- 其余所有命令都是**在你的机器上执行**的指令，本会话没有运行过。
- 本会话刻意**没有**运行 `npm run build` 和 `npm run test:e2e`：`127.0.0.1:3123` 上已有一个本仓库的 `next start` 实例在运行（实测见 [附录 A](#附录-a本会话真实执行过的命令与输出)），`playwright.config.ts` 的 `webServer` 默认也用 3123，会与它冲突。
- 本文不承诺任何平台的一键可用性。你换一家托管，就得自己重跑第 9 节的自检。

`docs/DEPLOYMENT.md` 是本会话新建的两个文件之一（另一个是 `docs/ANDROID.md`）。仓库里**没有** `Dockerfile`、`vercel.json`、`Procfile` 或任何 `.conf`（实测 `find` 结果为空，见附录 A）。

## 1. 你要部署的到底是什么

| 组成                                                | 位置                                                                                               | 部署含义                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Next.js 16 App Router 前端（静态外壳 + 客户端组件） | `app/`、`components/`、`features/`                                                                 | 需要 Node 服务端进程；页面被预渲染成静态外壳，真正的数据都在浏览器里     |
| 两个 AI route handler                               | `app/api/ai/status/route.ts`（GET）、`app/api/ai/analyze/route.ts`（POST + GET）                   | 唯一需要服务端运行逻辑的地方，必须有 Node                                |
| 用户数据                                            | 浏览器 IndexedDB，数据库名 `logicdaily`（`lib/db/database.ts:40`）                                 | 服务端**没有**数据库、没有账号、没有会话，不需要 Postgres/Redis/对象存储 |
| 题库                                                | `content/exercises/*.json` 14 个文件，被 `lib/content/packs.ts` 静态导入                           | 打进客户端分块，随 JS 下发，首次运行播种进 IndexedDB；不需要任何数据迁移 |
| 离线与安装                                          | `public/sw.js`、`app/manifest.ts`（`MetadataRoute.Manifest`，对外 URL 是 `/manifest.webmanifest`） | 只有 HTTPS 下浏览器才注册 Service Worker                                 |
| AI 上游                                             | 由 `AI_BASE_URL` 指定的 OpenAI 兼容接口                                                            | 可选。不配是受支持的降级状态（实测见第 9 节）                            |

一句话结论：**一台能跑 Node 22 的机器 + 一张 TLS 证书 + 一个反向代理**，就是完整部署。AI Key 是可选项。

技术栈实测版本（附录 A）：`next` 16.4.0、`react` 19.3.0、`node` v22.19.0、`npm` 10.9.3。

## 2. 运行环境要求

- **Node 版本**：`package.json` 里**没有** `engines` 字段（实测，见附录 A），所以任何版本都不会被 npm 拦下来。CI（`.github/workflows/ci.yml`）两个 job 都用 `node-version: 22`，本机实测 v22.19.0。建议：**生产用 Node 22 LTS**；不要用 18 及更早版本，因为没有任何测试在那个版本上跑过。
- **包管理器**：仓库只有 `package-lock.json`，没有 `pnpm-lock.yaml` / `yarn.lock`，所以用 `npm ci`。
- **磁盘**：需要容纳 `.next/` 构建产物；具体体积本会话未测量（没有运行构建）。
- **内存**：Next 16 默认把生成的缓存同时放内存（文档写默认约 50MB）和磁盘。本应用没有用户态服务端缓存需求，但多实例部署见第 5.4 节。
- **HTTPS**：必须。`components/service-worker-registration.tsx:13` 只在 `https:` 或主机名为 `localhost` / `127.0.0.1` 时注册 Service Worker；离线能力与「添加到主屏幕」都依赖它。

## 3. 本地跑起来

```bash
# 在你的机器上执行
npm ci
npm run dev
# 打开 http://localhost:3000
```

`npm run dev` 就是 `next dev`（`package.json` 实测脚本表），默认端口 3000；换端口用 `npm run dev -- -p 3123`。

### 3.1 首次打开时发生什么

这一段是读代码得出的（`app/providers.tsx`），不是运行日志：

1. `AppProviders` 在客户端调用 `getDatabase()` 并 `db.open()` 打开 IndexedDB 数据库 `logicdaily`。
2. 读 `settings`；没有则写入默认设置并记录检测到的时区。
3. `seedContent()` 先 `countExercises()`。如果已有题目，再比对题目数量与每题 `version`，一致就只做「本地题库已就绪（N 题）」；不一致才重新播种。
4. 空库时 `await import('@/lib/content/packs')` 拉取题库分块，`seedExercises(exercises, EXERCISE_CONTENT_TAG)` 写入 112 题（内容标签实测为 `content-v1.0`）。
5. **播种完成后**才 `setReady(true)`，注释写明是为了避免页面在空题库上生成「今日计划」。
6. 如果 `typeof indexedDB === 'undefined'`（隐私模式、旧内核），`storageOk` 置 false 并给出「当前浏览器禁用了本地存储……」的文案，UI 不会静默失败。

也就是说：**第一次访问需要联网**（下载 HTML + JS 分块 + 题库分块），之后离线可用是靠 Service Worker 缓存住这些分块（策略见 `docs/ANDROID.md`）。

### 3.2 本地调试的两个坑

- 本地 `http://localhost:3000` **也会注册 Service Worker**（上面那条判断把 localhost 列为例外）。改了 `public/sw.js` 后浏览器可能还在用旧的，调试前在 `chrome://serviceworker-internals` 或 DevTools → Application 里注销，或在无痕窗口测。
- 没有 `.env.local` 时 AI 一律是「未配置」，`/api/ai/analyze` 返回 503，这是预期行为，不是 bug。

## 4. 生产构建与自托管

```bash
# 在你的机器上执行（本会话未运行）
npm ci
npm run build
npm start                    # 默认 3000；换端口：npm start -- -p 3123
```

`npm run build` = `next build`，`npm start` = `next start`（实测脚本表）。`next start` 需要一个已经生成的 `.next/` 产物，所以构建必须**在同一台机器/同一镜像里**先跑；`NODE_ENV` 由 `next start` 自动置为 `production`。

`next.config.ts`（实测内容，全文只有 17 行）当前设置了：`cacheComponents: true`、`partialPrefetching: true`、以及把 `*.css` 交给 `@tailwindcss/turbopack` 的 turbopack 规则。**没有** `output` 字段（既不是 `standalone` 也不是 `export`），**没有** `headers()`/`rewrites()` 配置。这决定了：

- 想做第 6.3 节的 slim Docker 镜像，需要先自己加 `output: 'standalone'`。
- 想靠 `next.config.ts` 的 `headers()` 给 `/api/*` 加 `Cache-Control`，需要自己写（本仓库现在没有）。
- 环境变量的响应行为见下面这条重要提醒。

### 4.1 重要：AI 状态接口曾经被 Next 缓存（已修复，附实测）

这个 GET 处理器不读请求，在 `cacheComponents: true` 下会被**预渲染**并把结果按一年期共享缓存返回。实测当时的响应头：

```text
$ curl -s -I -m 10 http://127.0.0.1:3123/api/ai/status
HTTP/1.1 200 OK
x-nextjs-cache: HIT
cache-control: s-maxage=31536000
content-type: application/json
```

后果很实际：`readServerAiConfig()` 读的是 `process.env`，所以运维配好 Key 重启后，界面仍然对所有人显示「未配置」。

**当前实现已修**：`app/api/ai/status/route.ts` 在取值前 `await connection()`，把处理器标成请求期执行（`next build` 的路由表里它显示为 `ƒ (Dynamic)`）。修复后同一实例实测：

```text
$ curl -s -D - -o /dev/null http://localhost:3123/api/ai/status | grep -iE "HTTP/|cache-control|x-nextjs-cache"
HTTP/1.1 200 OK
```

即不再有 `x-nextjs-cache: HIT`，也不再下发 `cache-control`。注意 `export const dynamic = 'force-dynamic'` 在 `cacheComponents` 下**不被允许**（构建直接报错），`connection()` 才是这里的正确手段。

运维含义（上线前仍要自己验证一遍）：

1. 改完 `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` 等之后，**重新 `npm run build`**，否则「我的」页面和教练页可能仍显示「AI 教练未启用」。
2. CDN 必须对 `/api/*` 关闭缓存（第 5.3 节），否则用户会拿到别人/上一次的配置快照。

同一实例上 `curl -s -I http://127.0.0.1:3123/api/ai/analyze` 的 HEAD 响应没有返回 `cache-control`；但 POST 才是它的真实用途，POST 不会被任何 CDN 缓存。

顺带一提，`GET /api/ai/analyze` 与 `/api/ai/status` 返回同一份配置摘要（同一个 `publicAiStatus()`），实测两者都可用。

### 4.2 用 systemd 常驻（示例，本会话未运行、仓库里没有该文件）

```ini
# /etc/systemd/system/logicdaily.service  —— 示例内容，不是仓库文件
[Unit]
Description=LogicDaily (next start)
After=network.target

[Service]
Type=simple
User=logicdaily
WorkingDirectory=/srv/logicdaily
EnvironmentFile=/etc/logicdaily/env
ExecStart=/usr/bin/npm start -- -p 3000
Restart=always
RestartSec=5
# 只读根文件系统按需收紧
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/logicdaily/.next

[Install]
WantedBy=multi-user.target
```

## 5. 反向代理与 CDN

### 5.1 nginx 最小可用示例（示例，未在本机运行）

```nginx
# 示例配置，不是仓库文件；请按你的证书与域名调整
server {
  listen 443 ssl http2;
  server_name logic.example.com;
  ssl_certificate     /etc/letsencrypt/live/logic.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/logic.example.com/privkey.pem;

  # AI 请求正文可能到 12000 字符级别，留点余量
  client_max_body_size 256k;

  # /api/* 绝不缓存：AI 调用不能重复计费，配置状态要实时
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    # 关键：覆盖而不是追加，见 5.2
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # 允许流式响应
    add_header Cache-Control "no-store, max-age=0" always;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
  }
}

server { listen 80; server_name logic.example.com; return 301 https://$host$request_uri; }
```

Next 官方自托管文档（本仓库 `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`）也明确建议：自托管时把反向代理放在 `next start` 前面，由它处理畸形请求、慢连接、正文大小限制等；并且 nginx 需要关闭 buffering 才能正常流式输出。

### 5.2 `TRUST_PROXY_HEADERS`：限流按谁计数

`.env.example` 里的这一项**由 `app/api/ai/analyze/route.ts` 的 `actorKey()` 读取**：

```ts
const trusted = (process.env.TRUST_PROXY_HEADERS ?? '')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
for (const name of trusted) {
  const value = request.headers.get(name);
  ...
}
return 'shared';
```

由此得到三条**必须知道**的运维事实：

1. **留空 = 全站共享一个配额桶**（键为 `shared`）。这是安全侧的默认：不读任何客户端可伪造的转发头。代价是多用户部署下一个人就能用完当天额度。单用户自托管可以接受；有多人就配一个你的代理**必定覆写**的头。
2. **配置了就等于信任它**。设成 `x-forwarded-for` 时，如果 Node 被直接暴露、代理没有覆写这个头，任何人都能伪造它换一个新的限流身份，每 IP 限流与每日上限就形同虚设。所以上面的 nginx 示例用 `proxy_set_header X-Forwarded-For $remote_addr;`（覆写），不是 `$proxy_add_x_forwarded_for`（追加）。可以配多个头，逗号分隔，按顺序取第一个非空值。
3. **`AI_DAILY_LIMIT` 的日期键是 UTC**（`todayKey(new Date(), 'UTC')`，不是用户时区），每日重置点在服务器上等于 UTC 00:00。

如果你用 CDN（Cloudflare、Fastly 等），确认它**覆写** `X-Forwarded-For`；如果你只跑 nginx，就用 `$remote_addr`。上线前用第 9.3 节的方法实测一次限流身份是否真的按 IP 区分。

### 5.3 CDN 与缓存：Service Worker 不缓存 `/api/*`，但 CDN 会

`public/sw.js` 里对 API 的处理是明确的提前返回（实测代码，`sw.js:42-43`）：

```js
// API 一律不缓存：AI 调用不能重复计费，配置状态也要实时。
if (url.pathname.startsWith('/api/')) return;
```

所以浏览器侧永远不会缓存 AI 响应（而且 `lib/ai/client.ts:59` 请求 `/api/ai/status` 时还带了 `cache: 'no-store'`）。

**但 CDN 那一层没人替你管。** `/api/ai/status` 现在已是动态处理器（见 4.1），但 CDN 默认仍可能给 JSON 上一个它自己决定的 TTL，所以还是要显式对 `/api/*` 关闭缓存。实测的本仓库各路径响应头：

| 路径                    | 实测 `Cache-Control`                         | 你要做什么                                                                                    |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/api/ai/status`        | 无 `cache-control`（已改为动态，见 4.1）     | 仍在 CDN 上对 `/api/*` 强制 `no-store`，见 5.1                                                |
| `/api/ai/analyze`       | HEAD 请求未返回 `cache-control`              | 同样按 `/api/` 规则处理，别让它进缓存                                                         |
| `/`、`/train`           | `s-maxage=31536000`、`x-nextjs-prerender: 1` | 静态外壳可以被共享缓存，但发布后要 purge 或缩短 HTML TTL，否则用户拿旧壳去请求新 chunk 会 404 |
| `/sw.js`                | `public, max-age=0`                          | 保持不缓存（默认就正确）；注册时已用 `updateViaCache: 'none'`                                 |
| `/manifest.webmanifest` | `public, max-age=0, must-revalidate`         | 保持默认即可                                                                                  |

`.next/static` 之类的哈希资源由 Next 自己发 `immutable` 头，交给 CDN 长缓存是安全的。

### 5.4 多实例 / 无持久磁盘

`lib/ai/ratelimit.ts` 的文件注释写得很直白：单进程内存限流，对自托管单实例够用，多实例需要换成共享存储（Redis 等）。实测该文件还说明：

- 桶存在模块级 `Map` 里 → **进程重启即清零**，当日已用次数丢失。
- 桶数超过 512 才做清理。
- `AI_DAILY_LIMIT=0` 表示直接拒绝所有请求（`if (options.dailyLimit <= 0) return { allowed: false }`），可以用来「保留配置但关停 AI」。

所以：跑多个副本时，每个副本各有一份配额，实际上限 ≈ 配置值 × 副本数，并且重启会重置。要么先单实例部署，要么替换 `checkRate()` 的实现（接口形状已经固定，只影响那一个文件）。同理，Next 自身的页面缓存在多 pod 下也不共享（官方 self-hosting 文档的 `cacheHandler` 一节）。

## 6. 平台方案

### 6.1 Vercel（或同类 Next 托管）

- 构建命令 `npm run build`、启动命令沿用 `next start`（平台默认即可）。
- 所有 `AI_*` 变量在 Project Settings → Environment Variables 里配置，**不要**加 `NEXT_PUBLIC_` 前缀，**不要**提交 `.env`（`.gitignore` 已包含 `.env*`，实测文件内容）。
- 注意 Vercel 的环境变量默认在构建时可用；结合 4.1 的实测（状态 GET 会被缓存），改完变量要触发一次重新部署（重新构建），不要只重启。
- Serverless 场景下第 5.4 节的内存限流会变成「每个实例一份」，多实例并发下配额会漂。想认真控费，就在平台外做一层限流，或把 `checkRate()` 换成共享存储。
- 平台侧要能透传 `X-Forwarded-For`（Vercel 会设置），见 5.2。

### 6.2 任意 Node 主机 / PaaS

按第 4 节 `npm ci && npm run build && npm start`，前面挂第 5.1 节的代理即可。需要持久磁盘保存 `.next/`（构建产物），不需要别的存储。

### 6.3 Docker（示例：仓库里没有 Dockerfile，本会话未构建过任何镜像）

下面的 Dockerfile 只是**给你抄的样本**，它依赖一个你尚未做的改动：`next.config.ts` 目前没有 `output: 'standalone'`，不加的话 `.next/standalone` 不存在，`COPY` 那两行会失败。

```dockerfile
# 示例，不是仓库文件；本会话未执行 docker build
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 前提：next.config.ts 里加 output: 'standalone'
# 注意：NEXT_PUBLIC_* 会在 build 期内联进浏览器包，运行期改无效（本仓库目前没有任何 NEXT_PUBLIC_ 变量被代码读取）
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
# 运行期只需要 AI_* 这类服务端变量
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

要点：不要在镜像里烧进 `AI_API_KEY`；用运行期环境变量或 secret 注入。`public/`（含 `sw.js`、图标）必须一起复制，否则离线与安装失效。

### 6.4 纯静态托管（GitHub Pages、S3、Cloudflare Pages 之类）

- 用户数据本来就在浏览器 IndexedDB，纯静态能跑通训练/日志/复习/报告。AI 会不可用：`readAiStatus()` 在 `fetch` 失败时返回 `{ configured: false, unreachable: true }`，其兜底文案明确写着「纯静态部署时属于预期」（实测 `lib/ai/client.ts:67`）。
- 但要真正 `output: 'export'` 需要改配置并接受限制：Next 官方文档（本仓库内 `02-guides/static-exports.md` 的 Unsupported Features 一节）列出「依赖 Request 的 Route Handlers」不属于静态导出支持范围，而 `app/api/ai/analyze/route.ts` 的 POST 正是读 `Request` 的。**本会话未尝试过静态导出，不能保证它现在能构建成功。**
- 静态托管下 Service Worker 仍需要 HTTPS（GitHub Pages 默认给）。

## 7. 环境变量总表

来源：`.env.example` 全文 + 代码里真实读取的位置。作用域一栏：`server-only` = 只有 Node 运行时读取、不会进浏览器包；`NEXT_PUBLIC_` = 构建期内联进 JS，任何人都能在 DevTools 里看到。

| 变量                                                                                       | 必需 | 作用域                                  | 代码位置                             | 默认值                      | 不设置/设错会怎样                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ---- | --------------------------------------- | ------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_API_KEY`                                                                               | 否   | server-only                             | `lib/ai/config.ts:42`                | 空                          | AI 教练关闭。`configured = Boolean(apiKey && baseUrl)`，缺它 `POST /api/ai/analyze` 返回 503 `not_configured`（实测）。训练/日志/复习/报告不受影响                                                                                                                                                                                                                                                                                                                                                              |
| `AI_BASE_URL`                                                                              | 否   | server-only                             | `config.ts:43`                       | 空                          | 同上，AI 关闭。格式如 `https://api.openai.com/v1`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `AI_MODEL`                                                                                 | 否   | server-only                             | `config.ts:44`                       | `gpt-4o-mini`               | 用默认模型名；界面与状态接口的 `defaultModel` 就是它                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `AI_ALLOWED_BASE_URLS`                                                                     | 否   | server-only                             | `config.ts:45`、`lib/ai/ssrf.ts:68`  | 空                          | SSRF 允许列表。**为什么存在**：出站前 `resolveSafeTarget()` 要求目标必须命中允许列表，否则 `unsafe_url`（403）。`config.ts:46-48` 会在 `AI_BASE_URL` 没被列表覆盖时自动把它 unshift 进去，所以留空也能用自配的一个上游。列表项若无 scheme 会被当 `https://` 处理（`normalizeAllowEntry`）                                                                                                                                                                                                                       |
| `AI_ALLOW_CLIENT_BASE_URL`                                                                 | 否   | server-only                             | `config.ts:56`、`service.ts:171-182` | `false`                     | 保持 `false`。为 `true` 时客户端可指定 `baseUrl`，但仍必须在允许列表内                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `AI_ALLOW_LOOPBACK`                                                                        | 否   | server-only                             | `service.ts:211`                     | `false`                     | 仅本地开发把 `http://127.0.0.1`（如 Ollama）放行。生效条件是两个：`NODE_ENV !== 'production'` **且** 该值为 `true`。生产必须 `false`                                                                                                                                                                                                                                                                                                                                                                            |
| `AI_MAX_INPUT_CHARS`                                                                       | 否   | server-only                             | `config.ts:57`                       | `12000`，钳制区间 500–60000 | 只是配置快照（出现在状态接口 limits 里）；实际请求的硬门槛是 `service.ts:200` 用 `TASK_INPUT_LIMITS[task] + 4000` 判断，超出返回 `budget_exceeded`                                                                                                                                                                                                                                                                                                                                                              |
| `AI_MAX_OUTPUT_TOKENS`                                                                     | 否   | server-only                             | `config.ts:58`                       | `900`，128–4000             | 服务端上限；客户端请求的 `maxOutputTokens` 会被 `Math.min` 夹住                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `AI_TIMEOUT_MS`                                                                            | 否   | server-only                             | `config.ts:59`                       | `25000`，3000–120000        | 超时返回 504 `timeout`；`ping` 任务另按 15s 更严                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `AI_DAILY_LIMIT`                                                                           | 否   | server-only                             | `config.ts:60`                       | `60`，0–5000                | 每「限流身份 + 任务」每日（UTC）次数上限，超出 429 `budget/rate_limited`。设 0 = 全部拒绝                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `AI_RATE_LIMIT_PER_MIN`                                                                    | 否   | server-only                             | `config.ts:61`                       | `12`，1–300                 | 每分钟滑动窗口，超出 429 并带 `retry-after`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `AI_RETRY_LIMIT`                                                                           | 否   | server-only                             | `config.ts:62`                       | `2`，0–5                    | provider 重试次数，直接影响账单                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `TRUST_PROXY_HEADERS`                                                                      | 否   | 服务端（`app/api/ai/analyze/route.ts`） | 逗号分隔的头名                       | 空 = 不读任何转发头         | 见 5.2：留空时所有请求共用 `shared` 一个配额桶；配置后必须确保代理**覆写**该头                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `NEXT_PUBLIC_APP_URL`                                                                      | 否   | **已不存在**                            | —                                    | —                           | 模板里曾声明但全仓库无读取点，已从 `.env.example` 移除；如果你需要对外地址，自行加回并写实现                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | 否   | 前端内联 / server-only                  | —                                    | 空                          | **Phase 3 未接入**：实测代码目录（`app lib components features scripts tests public content`）里没有任何读取这些变量的代码，唯一提到 `supabase` 的地方是 `scripts/export-sql-seed.mjs` 的注释与输出路径。`supabase/migrations/` 下有 4 个 SQL（实测 `find`：`0000_local_stubs.sql`、`0001_init.sql`、`0002_auth_rls.sql`、`0003_seed_exercises.sql`），但应用内没有登录、没有同步，**设了这些变量也不会改变产品行为**。特别提醒：`SUPABASE_SERVICE_ROLE_KEY` 是绕过 RLS 的管理员凭据，绝不允许加 `NEXT_PUBLIC_` |

补充：`publicAiStatus()` 只对外暴露 `configured` / `defaultModel` / `allowedBaseUrlCount` / `allowClientBaseUrl` 和 limits，不暴露密钥也不暴露完整 URL（`service.ts:250` 用 `redactUrl()`）。

## 8. 上线前安全清单

逐项勾选，顺序无关紧要，前四项没做完就别对外announce。

- [ ] **密钥不在客户端。** `AI_API_KEY` 只能通过 `process.env` 在服务端读取（`lib/ai/config.ts` 的注释与 `.env.example` 的注释都强调了这点）。禁止：加 `NEXT_PUBLIC_` 前缀、写进 `next.config.ts` 的 `env` 字段（那份配置会被打进浏览器包）、写进前端组件。自查方式：构建后在浏览器 DevTools 的 Sources 里全文搜你的 Key 前缀，必须搜不到。
- [ ] **`.env*` 不进版本库。** 实测本仓库 `.gitignore` 含 `.env*`。同时确认托管平台的日志/预览功能不会把变量值打印出来。
- [ ] **密钥扫描。** CI 里目前**没有**密钥扫描步骤（实测 `.github/workflows/ci.yml` 全文：只有 checkout、setup-node、`npm ci`、`typecheck`、`npx eslint . --max-warnings=20`、`content:validate`、`test`、`build`，e2e job 用 `npx playwright install --with-deps chromium`）。若要开启，可在 CI 里自行加入 gitleaks / GitHub 的 Secret Scanning + Push Protection。本会话没有配置它，也没有验证它。
- [ ] **轮换方案。** 上游 Key 泄露时的处置顺序：上游吊销 → 新 Key 注入 → 重新构建（因为 4.1 的缓存行为）→ purge CDN `/api/*` → 用第 9 节自检确认 `configured` 变化。
- [ ] **限流与配额确实按客户端区分。** 见 5.2 的两个失效模式（可伪造 / 全共享一个桶）。至少实测一次：不同 IP（或不同伪造头）的请求是否落在不同桶里，看 `meta.remainingToday` 是否分别递减。
- [ ] **每日上限与上游账单硬上限都设了。** 应用侧 `AI_DAILY_LIMIT` 是内存计数，重启清零、多实例翻倍；**上游控制台的硬限额才是真防线**。
- [ ] **SSRF 允许列表收紧。** `resolveSafeTarget()` 实测行为：只允许 `https`（除非本地开发 loopback 模式）、拒绝 URL 里带凭据、**拒绝任何显式端口**（`url.port && allowLoopback !== true` → 上游必须用标准 443）、必须命中 `AI_ALLOWED_BASE_URLS`、DNS 解析后逐个地址做私网/保留段检查（含 `127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254.0.0/16` 云元数据、`100.64/10`、组播/保留段；IPv6 的 `::1`、`fc00::/7`、`fe80::/10`、IPv4 映射地址；无法识别的写法一律按不安全）。因此：**不要把 `0.0.0.0/0` 之类写进列表**，只写上你真正用的那一个主机。
- [ ] **跨站调用被挡。** `sameOriginGuard()` 对 Origin 主机与请求主机不一致时返回 403（实测，见 9.2）。这同时挡住了「别人在自己的页面里刷你的 AI 配额」。
- [ ] **日志不含正文。** 实测 `route.ts` 只 `console.log` 结构化字段 `{evt, task, model, ms, tokens, status}`，错误分支只记 kind，并注释说明错误对象可能带正文所以不入日志；`service.ts` 的注释同样声明日志与错误消息不含密钥/认证头/用户正文。确认你的日志采集层没有把 request body 打出来。
- [ ] **HTTPS 全站 + `/api/*` 不缓存**（第 5.1、5.3 节）。
- [ ] **多实例前先改限流**（第 5.4 节）。
- [ ] **许可证义务。** `package.json` 声明 `AGPL-3.0-or-later`，`LICENSE` 文件存在（实测）。把修改后的版本作为网络服务提供时，需要向该服务的用户公开对应源码；在站点上给出源码地址是部署工作的一部分。
- [ ] **发布流程包含一次第 9 节自检**，尤其是改过 AI 变量的那次发布。

## 9. 部署后自检

### 9.1 配置状态

```bash
curl -s https://你的域名/api/ai/status
curl -s -I https://你的域名/api/ai/status | grep -i cache-control
```

本会话在本地生产实例上的实测输出（`AI_*` 全部未配置，且机器上没有 `.env.local` / `.env`，实测两个文件都不存在）：

```text
$ curl -s -m 10 http://127.0.0.1:3123/api/ai/status
{"ok":true,"tasks":["analyze-reasoning","review-journal","analyze-material","recommend-practice","weekly-summary","ping"],"prompts":"prompts-v1","configured":false,"defaultModel":"gpt-4o-mini","allowedBaseUrlCount":0,"allowClientBaseUrl":false,"limits":{"maxInputChars":12000,"maxOutputTokens":900,"timeoutMs":25000,"dailyCallLimit":60,"rateLimitPerMinute":12}}
```

配置好 AI 后，期望看到 `configured: true`、`allowedBaseUrlCount >= 1`、`defaultModel` 等于你设的模型。如果 `configured` 仍是 `false`，先确认是否忘了重新构建（4.1）。

### 9.2 未配置时是受支持的降级状态

```text
$ curl -s -m 20 -X POST http://127.0.0.1:3123/api/ai/analyze \
    -H 'content-type: application/json' \
    -d '{"task":"ping","payload":{"note":"docs-check"}}' -w '\nHTTP=%{http_code}\n'
{"ok":false,"code":"not_configured","message":"模型服务尚未配置，基础训练功能不受影响。"}
HTTP=503

$ curl -s -m 20 -X POST http://127.0.0.1:3123/api/ai/analyze \
    -H 'content-type: application/json' -H 'Origin: https://evil.example' \
    -d '{"task":"ping","payload":{"note":"x"}}' -w '\nHTTP=%{http_code}\n'
{"ok":false,"code":"forbidden","message":"请求来源不被接受。"}
HTTP=403
```

即：**AI 关掉是被支持的产品状态**，不是异常。界面在 `/coach`、`/me` 上给出说明（`lib/ai/client.ts` 的 `not_configured` 文案「服务端还没有配置模型凭据，基础训练功能照常可用。」），e2e 里也有一条「未配置模型时，教练功能给出说明且不影响训练」的用例。

配置齐全后的期望值：`ok: true` + `meta`（含 `usedToday`、`remainingToday`）。其它错误码映射（实测 `route.ts` 的 `STATUS_BY_KIND`）：`unsafe_url` 403、`auth` 502、`timeout` 504、`rate_limited`/`budget_exceeded` 429、`not_configured`/`unavailable` 503、`bad_response`/`network` 502。

### 9.3 PWA 与限流

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://域名/manifest.webmanifest   # 期望 200（本会话在 127.0.0.1:3123 实测为 200，content-type 为 application/manifest+json）
curl -s -I https://域名/sw.js | grep -i cache-control                        # 期望 max-age=0 类
# 用同一分钟内两次以上快速 POST，看是否出现 429 且 retry-after 递减，
# 再用不同的 X-Forwarded-For 各打一测，确认限流确实是按 IP 分的（5.2）
```

浏览器侧的安装条件（HTTPS + manifest + Service Worker + 可安装图标）以及手机上怎么装，见 `docs/ANDROID.md`。

## 10. 测试套件：怎么跑、各覆盖什么

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .（CI 用的是 npx eslint . --max-warnings=20）
npm run test             # vitest run：单元 + 集成
npm run content:validate # node scripts/validate-exercises.mjs
npm run test:e2e         # playwright test（会自己起 next start -p 3123）
npm run test:coverage    # vitest run --coverage（v8，统计范围只有 lib/**）
```

| 命令                             | 覆盖                                                                                                                                                                                                                                                                                           | 本会话是否运行                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `npm run test`                   | 15 个文件：12 个单元（`lib/domain` 的 schema、判分、错因归因、调度、掌握度、每日计划、统计、时间、提醒决策 + `ai-security`）与 3 个集成（`local-store`、`training-flow`、`content`），集成用 fake-indexeddb 在 node 环境跑                                                                     | 已运行，全绿                        |
| `npm run typecheck`              | 全项目 TS 严格检查                                                                                                                                                                                                                                                                             | 已运行，exit 0                      |
| `npm run content:validate`       | 题库：id 规范、枚举、答案与解析自洽、重复题干、类别覆盖                                                                                                                                                                                                                                        | 已运行，通过                        |
| `npm run lint`                   | ESLint flat config                                                                                                                                                                                                                                                                             | **未运行**                          |
| `npm run test:e2e`               | `tests/e2e/core-flow.spec.ts` 6 个 + `tests/e2e/data-and-ai.spec.ts` 11 个 = 17 个 `test` 声明（引导、答题与错因归类、日志八步与证据清单、复习、报告、导出→清除→导入、AI 三种降级、393×851 溢出与遮挡）。配置为 `devices['Pixel 7']`、`workers: 1`、headless                                   | **未运行**（3123 已被现有实例占用） |
| CI（`.github/workflows/ci.yml`） | job `check`：`npm ci` → `typecheck` → `npx eslint . --max-warnings=20` → `content:validate` → `test` → `build`；job `e2e`（needs check）：`npx playwright install --with-deps chromium` → `CI=true npm run test:e2e`，失败上传 `playwright-report/` 与 `test-results/`。Node 22，ubuntu-latest | **本会话未触发 CI**                 |

本会话的真实输出：

```text
$ npm run typecheck        # 无任何诊断输出
$ echo $?
0

$ npm run test
 Test Files  15 passed (15)
      Tests  210 passed (210)
   Duration  1.16s (import 45%, transform 43%, tests 9%, worker 3%)

$ npm run content:validate        # 节选
共 112 道题，来自 14 个文件
覆盖错误类型 15/15
✓ 题库校验通过
```

注意：CI 的两个 job **都没有设置任何 `AI_*` 环境变量**，所以 e2e 覆盖的是「AI 未配置」的降级路径；配置齐全后的真实上游调用在 CI 里没有被测试。

## 11. 发布、更新与回滚

- **更新如何到达用户**：`public/sw.js` 的缓存名是硬编码的 `logicdaily-v1`，`activate` 时删掉所有不同名的旧缓存。`components/service-worker-registration.tsx` 用 `updateViaCache: 'none'` 注册，每小时 `registration.update()` 一次；新 SW 装好后**不自动接管**（避免用户正在作答被刷新），而是显示「有新版本可用」+「重新加载」按钮，点击时向 waiting SW 发 `skipWaiting`。因此：改了 `sw.js` 且希望强制清缓存，就同步递增那个缓存名；只改页面代码则靠哈希 chunk 自然更新。
- **HTML 与 chunk 的版本偏斜**：页面是预渲染静态壳（实测 `x-nextjs-prerender: 1`、`s-maxage=31536000`）。发布后如果 CDN 继续供旧 HTML、而旧 HTML 引用的 chunk 已被清掉，用户会白屏。做法：保留上一个构建的静态资源（或按构建 id 分目录），或发布后 purge HTML 与 `/manifest.webmanifest`、`/sw.js`。
- **数据兼容**：IndexedDB schema 目前是 `this.version(1).stores({...})`，`LOCAL_DB_VERSION = 1`、`BACKUP_SCHEMA_VERSION = 1`。破坏性变更要新增 `version(2)` 并写 `upgrade()`，同时保证旧备份 JSON 仍可导入：`lib/db/store.ts:603-625` 校验必需字段、`app === 'logicdaily'`、版本在 `1..BACKUP_SCHEMA_VERSION` 之间、`profileId` 非空；`lib/domain/settings.ts:105-108` 在迁移设置时丢弃 `settings.ai` 里的 `apiKey` / `key` / `token`（注意这个剥离只覆盖 `ai` 这一段，不是整份备份的递归脱敏）。
- **回滚**：回滚代码不会影响用户本地数据（数据库名固定为 `logicdaily`），但如果某次发布动过 schema 版本，回滚后的旧代码打不开新库（Dexie 的 version 只能单调递增）。所以 schema 变更要单独灰度。
- **建议的发布前命令序列**（在你的机器上执行）：`npm run lint` → `npm run typecheck` → `npm run content:validate` → `npm run test` → `npm run build` → `npm run test:e2e` → 部署 → 第 9 节自检。

## 12. 故障排查

| 现象                                       | 最可能的原因                                                                                    | 怎么确认                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 「我的」页显示 AI 未启用，但你明明配了 Key | 变量名拼错、值里有空格、或 CDN/浏览器仍在供旧的 `/api/ai/status` 响应（该处理器本身已改为动态） | `curl -i /api/ai/status` 看返回值与 `cache-control`；确认 `AI_API_KEY` 与 `AI_BASE_URL` **两者**都存在；purge CDN |
| 少量用户就触发 429 / 当日额度秒空          | 所有请求共享 `anonymous` 桶（代理没传 `X-Forwarded-For`）                                       | 在 Node 侧临时打印 `actorKey`，或看 `meta.usedToday` 是否随不同用户同步增长                                       |
| 用户能无限刷 AI                            | 进程被直接暴露，`X-Forwarded-For` 可伪造                                                        | 检查代理是否**覆写**该头；确认没有直连入口                                                                        |
| 多副本下配额像被放大                       | 限流是单进程内存实现                                                                            | 见 5.4                                                                                                            |
| 离线时白屏 / 某些页离线打不开              | 首次联网时没访问过该路由，分块未缓存；或改了 `sw.js` 但旧 SW 还在服务                           | DevTools → Application → Service Workers / Cache Storage 看 `logicdaily-v1` 里有什么                              |
| 手机上没有「添加到主屏幕」                 | 不是 HTTPS；或 manifest/SW 404；或该浏览器没实现 PWA 安装                                       | 见 `docs/ANDROID.md` 的安装条件核对表                                                                             |
| `/api/ai/analyze` 一直 403 `forbidden`     | 从别的源调用（`sameOriginGuard`）                                                               | 只允许同源页面调用；curl 不带 Origin 会被当作同源放行                                                             |
| 上游报 `unsafe_url`                        | `AI_BASE_URL` 不在允许列表、带显式端口、或解析到私网                                            | 检查 `AI_ALLOWED_BASE_URLS`；生产只允许标准 https 443（`resolveSafeTarget` 拒绝显式端口）                         |
| 首页长时间「正在载入题库…」                | IndexedDB 被隐私模式禁用                                                                        | 页面会显示 `storageOk=false` 的说明文案；换普通模式窗口验证                                                       |

## 附录 A：本会话真实执行过的命令与输出

均为只读或幂等的本地检查（`curl` GET/POST 只打到本仓库已在运行的实例，未发起任何外部 AI 调用）。工作目录：`E:\Users\luo17\AppData\Programs\Qoder\logicdaily`，Shell：Git Bash。

```text
$ node -v
v22.19.0

$ npm -v
10.9.3

$ node -e "console.log(require('./node_modules/next/package.json').version)"
16.4.0
$ node -e "console.log(require('react/package.json').version)"
19.3.0

$ grep -n '"engines"' package.json
（无输出，exit=1：package.json 里没有 engines 字段）

$ find supabase -type f
supabase/migrations/0000_local_stubs.sql
supabase/migrations/0001_init.sql
supabase/migrations/0002_auth_rls.sql
supabase/migrations/0003_seed_exercises.sql
# 说明：会话早期这个目录还不存在（当时 ls -d supabase 报 No such file），
# 写文档期间由仓库的其他改动创建。这里给的是最后一次实测的现状。

$ ls -a | grep -i env
.env.example
next-env.d.ts
# 即：.env.local 与 .env 都不存在

$ find . -path ./node_modules -prune -o -path ./.next -prune -o -iname "Dockerfile*" \
       -print -o -iname "vercel.json" -print -o -iname "Procfile" -print -o -iname "*.conf" -print
（无输出：仓库里没有 Dockerfile / vercel.json / Procfile / .conf）

$ netstat -ano | grep -i 3123 | head -2
  TCP    0.0.0.0:3123           0.0.0.0:0              LISTENING       16728
  TCP    [::]:3123              [::]:0                 LISTENING       16728

$ powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=16728').CommandLine"
"node"   "E:\Users\luo17\AppData\Programs\Qoder\logicdaily\node_modules\.bin\\..\next\dist\bin\next" start -p 3123

# 以下两条 grep 的检索范围只限代码目录，避免被 Markdown 自身干扰
$ grep -rn "TRUST_PROXY_HEADERS" app lib components features scripts tests public content
（无输出，exit=1）

$ grep -rn "PushSubscription\|pushManager\|showNotification\|new Notification(" app lib components features scripts tests public content
（无输出，exit=1）

$ grep -rn "decideReminder" app lib components features
./lib/services/reminders.ts:37:export function decideReminder(
（只有定义，没有调用点）

$ curl -s -I -m 10 http://127.0.0.1:3123/
HTTP/1.1 200 OK
x-nextjs-cache: HIT
x-nextjs-prerender: 1
Cache-Control: s-maxage=31536000
Content-Type: text/html; charset=utf-8
（其余头略）

$ curl -s -I -m 10 http://127.0.0.1:3123/sw.js | grep -i "cache-control"
Cache-Control: public, max-age=0

$ curl -s -I -m 10 http://127.0.0.1:3123/manifest.webmanifest | grep -i "cache-control\|content-type"
cache-control: public, max-age=0, must-revalidate
content-type: application/manifest+json

$ curl -s http://127.0.0.1:3123/ | grep -o '<meta name="viewport"[^>]*>'
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5"/>
```

> 上面这段附录是**文档写作当时的真实输出**，其后有三处代码已被修改，因此这些行不再反映当前行为：
>
> - `decideReminder` 现在由 `components/reminder-gate.tsx` 在应用打开时调用（此前只有定义）。
> - `/api/ai/status` 改为 `await connection()`，不再返回 `x-nextjs-cache: HIT` 与一年期 `cache-control`（见 4.1）。
> - meta viewport 现在包含 `viewport-fit=cover`（见 `docs/ANDROID.md` 3.1）。
>
> 保留原始输出是为了说明这些结论当初是怎么得出的，不要把它当作当前事实来源。

Android / Java 相关的环境检查（`java`、`adb`、`npx cap`）记录在 `docs/ANDROID.md` 的「环境实测」一节。

## 附录 B：本文档不能替你回答的问题

- 没有在你的任何环境上部署过，所以「这样配一定能跑起来」本文无权声称。
- 没跑 `npm run build`，所以不知道当前构建是否有警告、产物大小、构建耗时。
- 没跑 `npm run test:e2e` 与 `npm run lint`，本文只统计了 e2e 的 `test` 声明数量。
- 没触发 CI，所以第 10 节对 CI 的描述是读 `.github/workflows/ci.yml` 得来的。
- 没验证过 Vercel / Docker / 静态导出任何一条路径，第 6 节是方案性建议。
- `README.md` 里链接了 `docs/ARCHITECTURE.md`、`docs/DATA_MODEL.md`、`docs/AI_INTEGRATION.md`、`docs/PRIVACY.md`、`docs/PRODUCT_SPEC.md`、`SECURITY.md`、`CONTRIBUTING.md`、`CHANGELOG.md` 与 `supabase/migrations/`。本文开始写作时这些文件**都还不存在**（本会话实测过 `ls` 与 `git ls-files`），在写作期间由仓库的其他改动陆续创建。本文的每一个结论都只依据代码、配置与实测输出，没有把这些文档当依据；其中 5.2 节还指出了 `SECURITY.md` / `docs/AI_INTEGRATION.md` 对 `TRUST_PROXY_HEADERS` 的描述与实现不一致。若两者冲突，以你亲自跑出来的结果为准。
