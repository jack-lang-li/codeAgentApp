# Agent 接口调试台

适配现有 Spring MVC Java Agent 后端的本地前端工程。使用 Vue 3、Vite、TypeScript、Composition API 和 `<script setup>`，以原生 `fetch` 发送 POST 请求、增量读取 SSE，无 Router、Pinia 或大型 UI 库。

## 安装与启动

建议使用 Node.js 22.12+（本次验证使用 Node.js 24.14.0）及 npm。

在独立终端启动现有后端（需 Java 17、Maven，以及后端自身所需配置）：

```powershell
Set-Location C:\GPTproject\codeAgentProject\spring-agent-learning
mvn spring-boot:run
```

本工程没有修改或启动后端；后端密钥和服务配置由后端工程自行维护。启动后可访问 `http://localhost:8080/actuator/health`。

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

2026-10-28 只读检查了指定后端的 `ChatController`、`ChatRequest`、`ChatResponse`、`ChatService`、`GlobalExceptionHandler` 和相关路由配置。

| 模式 | 请求 | 用途 | 当前响应 |
| --- | --- | --- | --- |
| 自建 Agent | `POST /api/chat/chat` | Java 负责模型调用、工具执行与 Agent 循环 | JSON `{ "answer": "..." }` |
| Dify Workflow | `POST /api/chat/dify` | Java 调用已发布的 Dify Workflow，解析最终回答 | JSON `{ "answer": "..." }` |
| 健康检查 | `GET /actuator/health` | 检测后端可达性和健康状态 | 例如 `{ "status": "UP" }` |

每次聊天请求只有：

```json
{ "message": "查询订单10001的物流情况" }
```

源码与本次需求给出的路径、DTO 一致。**后端自身 README 仍有旧的 `POST /api/chat`、Mock 阶段说明，本工程以实际 Controller 为准，使用 `/api/chat/chat`。** 两条 Controller 方法当前都返回 `ChatResponse`，尚未实现 SSE。

`ChatRequest` 使用 `@NotBlank`；参数错误和非法 JSON 由异常处理器返回 HTTP 400 ProblemDetail，Dify 调用异常返回 HTTP 502 ProblemDetail。前端对所有非 2xx 优先显示 `detail`，其次 `message`、普通文本、HTTP 状态说明，错误独立显示，不作为助手正文。

健康检查成功仅表示后端可达，不代表模型密钥、模型调用或 Dify 工作流正常。Actuator 返回 HTTP 503 且正文包含 `status: DOWN` 时，也会显示“后端可达 · DOWN”。

## JSON 与 SSE 的兼容

发送的 Accept 为 `text/event-stream, application/json, application/problem+json`。先处理非 2xx，再依据实际 Content-Type 分支：

- `application/json`：一次读取并验证字符串 `answer`，标注 **JSON**。Dify 的 `data.outputs.answer` 由后端处理，前端不再解析它。
- `text/event-stream`：使用 `response.body.getReader()` 和 `TextDecoder.decode(..., { stream: true })` 增量读取，标注 **SSE**。流结束时 flush 解码器。
- 其他类型或缺少 Content-Type：明确报协议错误，调试面板保留 HTTP 状态和 Content-Type，并取消无效响应流。

Java 后续可在同一请求路径返回如下协议，前端无需切换“流式开关”：

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

所有记录仅存内存，刷新页面会清空。**消息列表是前端调试记录，不是多轮会话**；不会把旧问题附加到请求，也不会增加 `history`、`conversationId`、`modelCode`、`workflowCode` 或 `userId`。本工程不提供后端尚无接口的登录、模型管理、工作流管理或文件上传。

## 手动验证

1. **连接**：启动后端后点击“检测后端连接”，期望 `UP`；停止后端或使用不存在的代理目标后再检测，期望明确显示失败。模型接口仍需另行验证。
2. **长回答**：在自建 Agent 选择“长回答与代码”，发送“用中文分八点介绍 Java 接口和抽象类，并给出代码示例。”。当前后端应一次显示 JSON 回答；以后后端返回 SSE 才会逐段更新。检查换行、缩进和复制结果。
3. **工具调用**：发送“查询订单10001的物流情况，请先查订单，再根据运单号查物流。”。10001 是后端已有的模拟订单；最终回答和后端工具执行结果取决于后端模型及工具链路。前端不会自行调用订单或物流接口；JSON 阶段无法展示后端尚未发出的中间工具事件。
4. **Dify**：切换 Dify Workflow，发送“现在北京时间几点？”，确认请求路径是 `/api/chat/dify`，正文来自顶层 `answer`。
5. **取消**：发送耗时请求，接收期间点击“停止接收”。检查部分正文保留、停止提示、立即发送下一条请求后状态正常。JSON 回答完整返回前停止时，没有部分正文是正常现象。
6. **空白输入**：只输入空格或换行后发送，前端直接拒绝，网络面板中无新 POST。
7. **后端参数错误**：页面有空白校验；要验证实际 HTTP 400，可在前端启动后用下面的 PowerShell 请求。该请求不经过页面输入校验：

   ```powershell
   Invoke-WebRequest -Uri 'http://127.0.0.1:5173/api/chat/chat' `
     -Method Post -ContentType 'application/json' -Body '{"message":" "}'
   ```

   预期 HTTP 400，正文包含 `detail`；PowerShell 可能以异常形式展示非 2xx，这是正常的。

8. **断网及业务错误**：后端未启动时发送请求，页面应标记失败而非生成正常回答。后端真正返回 400 / 502 时检查 ProblemDetail 的 `detail`。SSE 阶段通过后端发出 `error` 或在 `delta` 后关闭而不发 `done`，分别验证业务失败和异常断流。

目前没有真实 Java SSE 接口，因此真实流式效果、真实工具调用和真实 Dify 成功结果，必须在后端运行并完成相应功能后再验证。自动测试使用独立的内存响应流，不访问模型供应商，不消费模型额度。

## 自动验证与目录

本次已执行并通过：`npm run typecheck`、`npm test`（43 项）、`npm run build`。测试覆盖：

- SSE 事件拆包、合包、中文按单字节分块、多行 data、心跳、BOM 和混合换行。
- 正文在连接关闭前到达、done 不等待 EOF、error 保留部分正文、未知事件和非法协议。
- 未收到完成事件的 EOF / 读取异常、主动取消、reader 锁释放。
- 正确请求路径与仅 message 请求体、JSON / SSE 分支、错误优先级、未知 Content-Type。
- 空白拦截、重复发送、模式隔离、清空、日志上限、停止后重发的异步竞争。

另已启动 Vite，确认首页 HTTP 200，并在浏览器中检查初始布局、示例填充、空白拦截、Ctrl+Enter 发送、模式记录隔离、调试面板折叠和后端未启动时的聊天 / 健康检查错误展示。截图保存在 `.qa/preview.png`（不参与构建）。

Windows 受限执行环境可能阻止 esbuild 子进程并报 `spawn EPERM`。本次在允许执行本地构建子进程的环境中重新运行后，上述检查全部通过。普通开发终端通常无需额外设置。

```text
src/
  api/chat.ts                 # fetch、响应分支、HTTP/SSE 错误和流生命周期
  utils/sse.ts                # 与网络无关的增量 SSE 分帧
  types/chat.ts               # 接口、请求记录和调试信息类型
  composables/useChat.ts      # 状态、记录、取消和请求身份隔离
  components/
    ChatPanel.vue             # 输入、正文、复制、滚动
    DebugPanel.vue            # 实际请求信息、耗时、事件与错误
    UiIcon.vue                # 内置 SVG 图标，无外部图标依赖
  App.vue                     # 模式切换、连接检测与页面布局
  main.ts
  styles.css                  # 普通 CSS 和响应式布局
tests/                        # Vitest 测试及内存流辅助工具
vite.config.ts                # 开发 / 预览代理
.env.example                  # 后端代理目标示例
```

本次检查时 `http://localhost:8080/actuator/health` 连接被拒绝，后端尚未运行。因此不宣称完成真实后端 JSON、真实 SSE、模型、工具或 Dify 的联调。
