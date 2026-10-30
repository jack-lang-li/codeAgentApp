# Agent 接口调试台

适配最新 Spring MVC Java Agent 后端的本地前端工程，支持登录后访问调试台、Cookie + Session、CSRF、自建 Agent SSE 和 Dify JSON。使用 Vue 3、Vite、TypeScript、Composition API 和 `<script setup>`，以原生 `fetch` 发送请求、增量读取 SSE，无 Router、Pinia 或大型 UI 库。

2026-10-30 已实际读取最新后端源码，逐项核对安全过滤链、放行规则、登录 / 注销、凭证、有效期、当前用户、权限、401 / 403 和 CORS / CSRF。完整依据和不确定事项见 [后端鉴权核对记录](docs/backend-auth-audit.md)。

## 安装与启动

建议使用 Node.js 22.12+（本次验证使用 Node.js 24.14.0）及 npm。

后端现在是 Maven 多模块工程，前端连接 **business-service**（需 Java 17、Maven，以及后端自身所需配置）。先在后端终端完成模块构建，再启动业务服务：

```powershell
Set-Location C:\GPTproject\codeAgentProject\spring-agent-learning
mvn -pl business-service -am install -DskipTests
mvn -pl business-service spring-boot:run "-Dspring-boot.run.profiles=dev"
```

开发账号数据源仅在 `dev` Profile 生效，账号为 alice / bob，密码由后端运行环境的 `APP_DEV_ALICE_PASSWORD`、`APP_DEV_BOB_PASSWORD` 配置。启动前还需由后端运行者设置模型 / Dify 配置；前端不保存这些配置，不硬编码密码。不要把后端测试代码中的密码当作运行环境密码。本工程没有修改或自行启动后端；启动后可访问 `http://localhost:8080/actuator/health`。

再在另一个终端启动前端：

```powershell
Set-Location C:\GPTproject\codeAgentApp
npm install
Copy-Item .env.example .env.local
npm run dev
```

打开 **http://127.0.0.1:5173**。如果 5173 已被占用，可用 `npm run dev -- --port 5174` 指定其他端口。已有锁文件时也可使用 `npm ci` 还原完全相同的依赖。

```powershell
npm run typecheck   # Vue、应用源码、配置及测试的 TypeScript 检查
npm test            # 一次执行协议与请求状态测试
npm run test:watch  # 持续测试
npm run build      # 类型检查 + 生产构建，产物位于 dist/
npm run preview    # 本地预览构建产物，默认 http://127.0.0.1:4173
```

依赖安装需要可用的 npm 网络源。若本机 npm 开启了离线模式，可运行 `npm install --offline=false`；本机原有 npm 配置中的 `Unknown user config "home"` 警告不由本工程产生。

### 在 IDEA 中点击启动

工程已提供共享的 npm 运行配置 `.run/启动前端.run.xml`，执行当前工程的 `dev` 脚本，等价于 `npm run dev`。

1. 在 IDEA 中打开 `C:\GPTproject\codeAgentApp`。如果工程已经打开但尚未显示新配置，关闭该工程窗口后重新打开。
2. 在右上角运行配置下拉框选择 **启动前端**，点击绿色三角形 **Run**，以后每次均可直接点击启动。
3. 在 Run 窗口看到 Vite 的 Local 地址后，打开 `http://127.0.0.1:5173`。点击红色方块 **Stop** 停止前端。

配置使用已检测到的本机 Node.js：`C:\Program Files\nodejs\node.exe`。换机器或 Node 安装位置发生变化时，在 **Run → Edit Configurations → 启动前端** 中修改 Node runtime / Node interpreter 即可；package.json、Command、Scripts 已分别设置为本工程的 `package.json`、`run`、`dev`。

该配置需要 IDEA 提供 npm / Node.js 支持；若提示未知配置类型，请检查 **Settings → Plugins** 中的 JavaScript / Node.js 支持及当前 IDEA 版本是否可用。也可以打开 `package.json`，点击 `dev` 脚本旁的绿色运行按钮创建配置。后端仍在它自己的 IDEA 窗口中单独启动。

配置字段和运行方式参见 [JetBrains 的 npm 运行配置文档](https://www.jetbrains.com/help/idea/run-debug-configuration-npm.html)。本次已校验配置 XML、脚本及 Node 路径，尚未在用户的 IDEA 界面中点击运行。

## 登录与会话

打开首页会先调用 `GET /api/auth/me` 验证已有会话。未登录返回 `/login`；只有服务端身份验证成功才挂载调试页面。直接输入首页地址、刷新和浏览器返回均不能跳过验证。

登录流程：

1. `GET /api/auth/csrf` 获取 `{ headerName, token }`，浏览器接收匿名 Session Cookie。
2. 携带该请求头，以 `application/x-www-form-urlencoded` 提交 `username`、`password` 到 `POST /api/auth/login`。
3. 成功响应必须为 HTTP 204。重新获取登录后的 CSRF（旧令牌已失效），再查询 `/api/auth/me` 确认真实调用者；不会凭 204 伪造用户。
4. 每个聊天 / 注销 POST 自动附带 CSRF，所有受保护请求明确使用 `credentials: same-origin`，由浏览器携带 HttpOnly JSESSIONID Cookie。

当前用户显示后端返回的 `callerId`、`tenantId`、`callerType`。后端没有返回用户名、角色或权限集合，也没有独立权限接口；当前两个聊天模式都只要求已登录，前端不臆造管理员权限。

会话默认 **30 分钟空闲超时**，不是绝对 30 分钟到期。没有 JWT、Bearer、刷新令牌、定时保活或“记住我”；密码、CSRF、用户身份均不写入 localStorage / sessionStorage。刷新后凭 Cookie 重新验证，页面重新获得焦点时也会复查，不用轮询延长会话。

- HTTP 401 `UNAUTHENTICATED`：返回登录页，卸载调试台并停止当前流，清理内存记录。
- 登录 401 `LOGIN_FAILED`：显示“用户名或密码错误”，不进入调试台。
- 403 `CSRF_INVALID`：丢弃缓存 CSRF，复查 `/me` 区分会话失效和令牌轮换；令牌有效后由用户重新发送，**不自动重放聊天请求**。
- 普通 403 `FORBIDDEN`：显示后端拒绝原因，不伪装成会话过期，也不绕过权限。
- 点击“退出登录”：携带 CSRF POST `/api/auth/logout`，必须收到 204 才确认退出。后端使 Session 无效并删除 Cookie；失败会明确提示重试。退出、失效或切换调用者时丢弃旧账号的记录，避免跨账号显示。

## 代理目标

`.env.example` 提供：

```dotenv
VITE_BACKEND_TARGET=http://localhost:8080
```

复制为 `.env.local` 后按实际地址修改，随后重启 Vite。也可以在启动终端设置：

```powershell
$env:VITE_BACKEND_TARGET = 'http://localhost:8081'
npm run dev
```

浏览器始终使用 `/api`、`/actuator` 相对路径。Vite 将这两类路径转发到上述目标，**保留完整路径，不移除 `/api`**，因此无需修改 Java CORS 配置。前端不会访问模型供应商或 `api.dify.ai`。

代理的 `timeout` 和 `proxyTimeout` 为 `0`，不设置响应体转换或聚合，允许 SSE 持续传输。生产静态托管时，Vite 开发代理不再存在，需要由部署环境提供相同路径的反向代理，并关闭 SSE 响应缓冲；`npm run preview` 仅用于本地验证，不是生产服务器。

`VITE_BACKEND_TARGET` 仅用于配置代理，不是密钥。前端没有模型密钥、Dify 密钥、userId 或其他尚未实现的参数输入框。

## 已核对的后端接口

2026-10-30 只读检查了指定后端的最新安全配置、鉴权接口、聊天 Controller / DTO、身份提供器、错误处理和服务配置。

| 模式 | 请求 | 用途 | 当前响应 |
| --- | --- | --- | --- |
| 自建 Agent | `POST /api/chat/chat` | Java 负责模型调用、工具执行与 Agent 循环 | SSE：status / delta / done / error |
| Dify Workflow | `POST /api/chat/dify` | Java 调用已发布的 Dify Workflow，解析最终回答 | JSON `{ "answer": "..." }` |
| 健康检查 | `GET /actuator/health` | 检测后端可达性和健康状态 | 例如 `{ "status": "UP" }` |

每次聊天请求只有：

```json
{ "message": "查询订单10001的物流情况" }
```

聊天路径和请求 DTO 保持一致。最新自建 Agent Controller 已返回 `StreamingResponseBody`，Dify 仍返回 `ChatResponse`。身份和 Dify 用户标识由后端从认证主体取得，前端仍只发 message。后端自身 README 中仍有“没有登录系统”的旧说明，本工程以实际 Java 源码为准，详细差异见鉴权核对记录。

`ChatRequest` 使用 `@NotBlank`；参数错误和非法 JSON 由异常处理器返回 HTTP 400 ProblemDetail，Dify 调用异常返回 HTTP 502 ProblemDetail。前端对所有非 2xx 优先显示 `detail`，其次 `message`、普通文本、HTTP 状态说明，错误独立显示，不作为助手正文。

健康检查成功仅表示后端可达，不代表模型密钥、模型调用或 Dify 工作流正常。Actuator 返回 HTTP 503 且正文包含 `status: DOWN` 时，也会显示“后端可达 · DOWN”。

## JSON 与 SSE 的兼容

发送的 Accept 为 `text/event-stream, application/json, application/problem+json`。先处理非 2xx，再依据实际 Content-Type 分支：

- `application/json`：一次读取并验证字符串 `answer`，标注 **JSON**。Dify 的 `data.outputs.answer` 由后端处理，前端不再解析它。
- `text/event-stream`：使用 `response.body.getReader()` 和 `TextDecoder.decode(..., { stream: true })` 增量读取，标注 **SSE**。流结束时 flush 解码器。
- 其他类型或缺少 Content-Type：明确报协议错误，调试面板保留 HTTP 状态和 Content-Type，并取消无效响应流。

最新 Java Agent 在同一请求路径返回如下协议，前端无需切换“流式开关”：

```text
event: status
data: {"message":"正在请求模型，第 1 轮"}

event: delta
data: {"text":"正文第一段"}

event: delta
data: {"text":"\n  保留换行和缩进"}

event: done
data: {}

```

每个事件必须由空行结束。`status` 只更新状态；`delta.text` 原样追加正文；`done` 标记完成，不重复追加回答；`error` 读取 `message` 并标记失败，同时保留部分正文。HTTP 200 的 SSE `error` 同样属于失败。

解析器支持事件拆包、同一块多个事件、中文字符跨字节块、LF/CRLF（包括分块的 CRLF）、多行 `data`、注释心跳和 UTF-8 BOM。未知事件仅写入调试日志，不追加正文；不解析 OpenAI 原始事件或 `[DONE]`。连接结束或读取异常且未收到 `done`/`error`，提示 **“连接中断，未收到完成事件”**；缺少空行的末尾 `done` 不会被误判为完成。

**没有定时拆分完整回答的伪流式逻辑。** 状态栏耗时的计时器只刷新时间。

## 页面操作

- 左侧切换自建 Agent / Dify Workflow。每种模式分别保存消息记录、草稿与选中的调试请求。一次只允许一个聊天 POST；请求期间锁定模式切换和重复发送。
- 多行输入，`Ctrl+Enter` 发送；拒绝空白输入。示例仅填入输入框，点击发送后才调用后端。
- “停止接收”用 `AbortController` 取消当前浏览器请求，显示“已停止接收”并保留部分正文。**这不保证后端任务或模型已立即停止。** 停止后可以马上发送新请求，旧请求的回调与清理不会覆盖新请求。
- “清空记录”只清空当前模式的前端调试记录；当前模式有请求时先停止接收。不会发送后端清理请求。
- 回答以 Vue 文本插值和 `white-space: pre-wrap` 安全显示，保留换行、缩进，不执行 HTML 或渲染 Markdown。可复制完整正文，复制失败会给出提示。
- 生成时跟随底部；上滚查看旧内容后不强制拉回，点击“回到最新消息”恢复跟随。
- 点击每条记录的“查看调试”可检查该次请求。右侧调试面板可折叠，展示路径、实际请求体、响应信息、开始时间、耗时、事件和错误详情。
- SSE 日志默认保留最近 100 条，可选 50 / 100 / 200；每条 `data` 日志预览最多 2000 字符，错误响应预览最多 8000 字符。这些限制只针对调试预览，**不裁剪回答正文**。

所有聊天记录仅存内存，刷新页面会清空。**消息列表是前端调试记录，不是模型的多轮会话**；鉴权 Session 用来识别调用者，不代表聊天有多轮记忆。不会把旧问题附加到请求，也不会增加 `history`、`conversationId`、`modelCode`、`workflowCode` 或 `userId`。本工程提供与后端一致的登录 / 注销，不提供尚无接口的模型管理、工作流管理或文件上传。

## 手动验证

1. **登录与连接**：先用真实账号登录；错误密码应留在登录页，匿名直接访问首页也应返回登录页。登录后点击“检测后端连接”，期望 `UP`；停止后端或使用不存在的代理目标后再检测，期望明确显示失败。模型接口仍需另行验证。
2. **长回答**：在自建 Agent 选择“长回答与代码”，发送“用中文分八点介绍 Java 接口和抽象类，并给出代码示例。”。最新后端应标注 SSE 并随 delta 更新，最后收到 done。检查换行、缩进和复制结果；若部署了旧版 JSON 后端，也保留兼容，但旧版没有鉴权接口时不能伪造登录绕过。
3. **工具调用**：发送“查询订单10001的物流情况，请先查订单，再根据运单号查物流。”。10001 是后端已有的模拟订单；最终回答和后端工具执行结果取决于后端模型及工具链路。前端不会自行调用订单或物流接口；JSON 阶段无法展示后端尚未发出的中间工具事件。
4. **Dify**：切换 Dify Workflow，发送“现在北京时间几点？”，确认请求路径是 `/api/chat/dify`，正文来自顶层 `answer`。
5. **取消**：发送耗时请求，接收期间点击“停止接收”。检查部分正文保留、停止提示、立即发送下一条请求后状态正常。JSON 回答完整返回前停止时，没有部分正文是正常现象。
6. **空白输入**：只输入空格或换行后发送，前端直接拒绝，网络面板中无新 POST。
7. **后端参数错误**：页面有空白校验。验证实际 HTTP 400 需要先登录、使用同一 Cookie 和登录后的 CSRF；缺少它们会先得到 401 或 403。可在浏览器网络面板复制一个已登录聊天请求，保留 Cookie / CSRF 后把请求体改为 `{"message":" "}` 再发送。不要共享复制出来的 Cookie / CSRF。

   ```powershell
   Invoke-WebRequest -Uri 'http://127.0.0.1:5173/api/chat/chat' `
     -Method Post -ContentType 'application/json' -Body '{"message":" "}'
   ```

   上面的无 Cookie / CSRF PowerShell 请求会首先验证安全边界，预期 403 `CSRF_INVALID`。只有已登录并携带有效 CSRF 后，纯空白 message 才会得到 400 参数错误。

8. **断网及业务错误**：后端未启动时发送请求，页面应标记失败而非生成正常回答。后端真正返回 400 / 502 时检查 ProblemDetail 的 `detail`。SSE 阶段通过后端发出 `error` 或在 `delta` 后关闭而不发 `done`，分别验证业务失败和异常断流。

9. **过期、拒绝和退出**：用另一个同源标签页退出，再回到原页应复查会话并回登录页；也可等待真实空闲超时。已登录访问未放行接口会返回 403 `FORBIDDEN`。点击退出后直接刷新首页，不能回到旧账号记录。

最新源码已有真实 Java SSE 接口。真实生成、工具执行和 Dify 成功结果仍取决于实际账号及后端上游配置，需分别记录验证结果。自动测试使用独立内存响应流，不访问模型供应商，不消费模型额度。

### 可重复的真实接口验证

```powershell
npm run verify:backend
```

默认访问 `http://127.0.0.1:8080`，验证公开健康检查、匿名 401、CSRF 403、错误账号 / 密码和两个受保护业务接口。结果写入 `.qa/backend-verification.json`，不含密码、Cookie 或 CSRF 令牌。

可通过 `AUTH_TEST_BASE_URL` 指定其他业务服务地址，或指向前端代理 `http://127.0.0.1:5173`。仅当在当前终端明确提供 `AUTH_TEST_USERNAME`、`AUTH_TEST_PASSWORD` 时，脚本才进一步验证成功登录、登录前 CSRF 失效、已登录普通 403、真实 Agent SSE / Dify JSON，以及退出后原会话失效。它会发送两条很短的测试问题；没有凭证时明确跳过，不猜测密码。请使用专用测试账号，不把密码写入本工程文件。

## 自动验证与目录

本次已执行并通过 `npm run typecheck`、`npm test`（76 项）、`npm run build`。原工程检查命令保持不变，测试涵盖：

- SSE 事件拆包、合包、中文按单字节分块、多行 data、心跳、BOM 和混合换行。
- 正文在连接关闭前到达、done 不等待 EOF、error 保留部分正文、未知事件和非法协议。
- 未收到完成事件的 EOF / 读取异常、主动取消、reader 锁释放。
- 正确请求路径与仅 message 请求体、JSON / SSE 分支、错误优先级、未知 Content-Type。
- 空白拦截、重复发送、模式隔离、清空、日志上限、停止后重发的异步竞争。
- Cookie / CSRF 传递与轮换、表单登录、204 校验、真实用户结构、401 / 403 区分、会话失效、注销失败和跨账号状态隔离。

已连接用户启动的真实后端，匿名协议检查全部通过。用户在登录页自行输入真实密码后，浏览器确认以下真实流程：

- 登录成功，`/me` 验证后显示调用者 `demo-user-1`；错误账号及已有账号的错误密码均留在登录页并显示后端错误。
- Agent HTTP 200 / SSE：收到 120 个事件，最终 `done`，约 2.04 秒完成。日志上限仍生效，正文完整保留。
- Dify HTTP 200 / JSON：从顶层 answer 显示回答，约 19.02 秒完成。
- 已登录访问 `/api/not-registered` 得到 403 `FORBIDDEN`。
- 另一个同源页面退出后，原页面再次请求会识别失效会话，回到登录页并清除旧记录。

脚本证据位于 `.qa/backend-verification.json`，浏览器验证记录位于 `.qa/browser-verification.json`，截图位于 `.qa/auth-sse.png`、`.qa/auth-dify.png`、`.qa/auth-session-expired.png`。这些文件不参与构建，也不含密码 / Cookie / CSRF 令牌。

尚未等待真实 30 分钟空闲超时；本次用另一个标签页注销导致的真实 Session 失效验证同一处理流程。没有细粒度角色权限可测。Dify 返回的北京时间约比验证时实际北京时间快 8 小时，已记录为工作流业务内容的时区问题，前端不擅自修正后端答案。

Windows 受限执行环境可能阻止 esbuild 子进程并报 `spawn EPERM`。本次在允许执行本地构建子进程的环境中重新运行后，上述检查全部通过。普通开发终端通常无需额外设置。

```text
src/
  api/chat.ts                 # fetch、响应分支、HTTP/SSE 错误和流生命周期
  api/http.ts                 # 同源 Cookie / CSRF 和统一安全错误
  api/auth.ts                 # 表单登录、CSRF 轮换、当前用户、注销
  utils/sse.ts                # 与网络无关的增量 SSE 分帧
  types/chat.ts               # 接口、请求记录和调试信息类型
  composables/useChat.ts      # 状态、记录、取消和请求身份隔离
  composables/useAuth.ts      # 经服务端验证的身份及会话状态
  components/
    ChatPanel.vue             # 输入、正文、复制、滚动
    LoginView.vue             # 登录页
    DebugConsole.vue          # 登录后的调试台、当前身份和退出
    DebugPanel.vue            # 实际请求信息、耗时、事件与错误
    UiIcon.vue                # 内置 SVG 图标，无外部图标依赖
  App.vue                     # 登录状态与页面 / URL 守卫
  main.ts
  styles.css                  # 普通 CSS 和响应式布局
tests/                        # Vitest 测试及内存流辅助工具
scripts/verify-backend.mjs     # 真实后端接口检查，不输出敏感凭证
docs/backend-auth-audit.md    # 源码依据、接口差异和不确定事项
vite.config.ts                # 开发 / 预览代理
.env.example                  # 后端代理目标示例
```

后端始终只读；本次所有工程修改都位于当前前端目录。未验证事项及验证证据见鉴权核对记录和 `.qa/backend-verification.json`。
