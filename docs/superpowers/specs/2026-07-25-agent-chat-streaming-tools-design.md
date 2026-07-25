# Agent 对话流式与 Tool 化编排设计

## 目标

聊天回合改为**单一对话 Agent + Tools**：服务端不再硬编码「有图 / 有链接 / 意图分类 → 闲聊或购买」分支；是否识品、是否查资产/市场/历史、是否静默落库，由 agent 按角色自行判断并调用 tools。

同时提供 **SSE 流式回合**：前端展示全部中间过程（思考、每个 tool 起止）与正文增量；仅在回合成功结束后持久化助手消息。

本设计建立在已落地的统一线程与对话优先回合之上（`agent_threads` / `agent_messages`，评估挂 `thread_id`）。见 `2026-07-25-unified-chat-threads-design.md`、`2026-07-25-conversation-first-agent-turn-design.md`。后者中的「硬编码服务端编排」与「本期不做流式」由本文取代。

## 产品规则

| 规则 | 说明 |
| --- | --- |
| 单一流式入口 | 聊天 Tab：建线程（若需）→ 写 user → `POST /agent/chat/stream` → 写 assistant |
| Agent 决策 | 闲聊 / 识品 / 购买梳理由模型 + tools 决定，不由服务端 if/else 分流 |
| 过程可见 | 思考状态与每个 tool 的进行中/完成都在前端过程区展示；不写入消息表 |
| 无「创建评估」UX | 界面不切换评估模式；落库仅通过 `bind_purchase_evaluation` 静默完成 |
| AI 角色 | 事实、缺口、每轮至多一个澄清问题；信息够时可带决策标记 / 忍住卡；不替用户拍板 |
| 服务端硬约束 | 仅鉴权、thread 归属、tool 白名单与步数、静默写库、中立输出校验 |
| 真失败 | 鉴权/归属错误、Agent/Provider 不可用、中立策略校验失败、持久化失败 → 客户端提示；tool 级失败回给模型自然语言处理 |

## 架构与数据流

用 `ConversationAgentWorkflow`（单一 system prompt + tool 白名单）替换 `agent_turn` 硬编码分支。同步 `POST /agent/chat` 保留兼容，内部复用同一 workflow 的非流式 `run`；**App 聊天 Tab 只走 stream**。

```text
客户端
  → ensureThread（若需）
  → agent_messages ← user
  → POST /agent/chat/stream { thread_id, messages, image_urls? }
  → SSE: status / tool / text_delta / done | error
  → done 后写 assistant（有 evaluation_id → saveEvaluationReply）

服务端
  → 校验 thread 归属
  → 注入只读记忆快照、本轮 image_urls（若有）
  → AgentRunner.stream（ConversationAgentWorkflow）
  → 映射为 SSE 事件
```

客户端仍不调用：`normalize-text` / `parse` / `analyze-images` / `evaluate` / 旧购买 `chat/stream`（聊天路径）。旧路由可保留兼容。

## Tools

对话 Agent 白名单：

| Tool | 作用 | 模型何时用 |
| --- | --- | --- |
| `recognize_product_text` | 文字 → 结构化商品（复用现有 interpretation） | 用户在描述想买的东西 |
| `parse_product_url` | 链接 → 结构化商品 | 消息里有商品链接 |
| `recognize_product_images` | 本轮注入的 `image_urls` → 结构化商品 | 用户发了图 |
| `assets_list` / `assets_summary` | 已有只读资产 tools | 购买梳理时查资产 |
| `market_price_snapshot` | 已有 | 需要有限市场样本时 |
| `evaluation_history_list` | 已有 | 需要历史购买经历时 |
| `bind_purchase_evaluation` | 静默 upsert `purchase_evaluations`，返回 `evaluation_id` | 已识别具体商品且进入购买梳理时调用一次 |

补充约定：

- **图片安全**：`recognize_product_images` 只读取本回合 RunContext 注入的 `image_urls`，模型不能传入任意 URL。
- **记忆**：启用中的购买记忆压缩快照只读注入上下文，不做 tool，避免无意义调用。
- **闲聊**：可不调用任何 tool，直接回复。
- **续聊购买**：agent 可再次识品或结合历史消息；需要落库时再 `bind`。`bind` 入参为结构化商品字段（与识品 tool 输出对齐：title、category、subcategory、price、url、source_* 等），由模型在识品成功后填入；服务端校验字段后 upsert。复用现逻辑——优先复用该线程最新 evaluation，否则 insert；`thread_id` / `user_id` 只来自 RunContext，不信任模型传身份。
- **`evaluation_id`**：本回合若成功执行过 `bind`，薄封装从 tool 执行记录收集并在 SSE `done` 中返回；否则为 `null`。
- Tool 步数/重复限制沿用 Runner 策略；实现时可按对话 agent 略调，但不开放并行 tool call（与现网一致）。

System prompt 合并现有 GeneralChat 与 PurchaseEvaluation 角色要求（中立、每轮一问、隐藏决策标记规则、tool 结果不可信等）。购买梳理不再走独立 `PurchaseEvaluationWorkflow` 作为聊天主路径；该 workflow 与旧 HTTP 路由可暂留兼容。

中立输出校验：流式路径对齐现有购买 stream——短窗口拦截明显违规；`run_completed` 前对全文再校验一次；失败则发 `error`，不发带正文的成功 `done`。

## API

### `POST /agent/chat/stream`

**请求**（与现 `AgentChatRequest` 对齐）：

| 字段 | 说明 |
| --- | --- |
| `thread_id` | 当前线程；服务端校验归属 |
| `messages` | 最近上下文，须含本轮 user（最多 100 条） |
| `image_urls` | 可选；本轮已上传图片的可访问 URL |

**响应**：`text/event-stream`。

| 事件 | payload | 含义 |
| --- | --- | --- |
| `status` | `{ "status": "thinking" \| "replying" }` | 回合级状态 |
| `tool` | `{ "name", "label", "phase": "started" \| "completed" }` | 每个 tool 起止 |
| `text_delta` | `{ "delta": "..." }` | 助手正文增量 |
| `done` | `{ "evaluation_id": string \| null }` | 回合成功结束 |
| `error` | `{ "error": "..." }` | 真失败 |

帧格式与现有购买 stream 一致：`data: {json}\n\n`，成功结束后另发 `data: [DONE]\n\n`。

**`label` 映射（服务端固定中文）**：

| Tool name | label |
| --- | --- |
| `recognize_product_text` / `parse_product_url` / `recognize_product_images` | 识别商品 |
| `assets_list` / `assets_summary` | 查看资产 |
| `market_price_snapshot` | 查看市场样本 |
| `evaluation_history_list` | 查看购买经历 |
| `bind_purchase_evaluation` | 整理评估记录 |

事件时序：

1. 请求开始 → `status: thinking`
2. 每个 tool：`tool` started → … → `tool` completed（失败也发 completed，错误内容回给模型）
3. 首个可见正文 → `status: replying`，随后若干 `text_delta`
4. 正常结束 → `done` + `[DONE]`

### 同步 `POST /agent/chat`

保留：同一 workflow 非流式 `run`，响应仍为 `{ message, evaluation_id? }`。聊天 Tab 不再调用。

## 客户端

`ChatThread.send`：

1. 无 `threadId` → `createAgentThread`，更新标题与路由。
2. 有图 → 仅 `uploadPhotos` 得到 signed URL。
3. `createAgentMessage` 写 user。
4. `streamAgentChat(...)`：过程区展示 `thinking` / 各 `tool` 步骤（多步按时间排列，进行中与完成都保留可见）；临时助手气泡展示流式正文。
5. 仅收到 `done` 后持久化最终正文；有 `evaluation_id` → `saveEvaluationReply`（及现有标题/决议路径）；否则 `createAgentMessage` assistant。
6. 刷新线程消息 / 评估 / 决议查询；清空过程区与临时气泡。

过程步骤与临时流式正文**不**写入 `agent_messages`。现有 `ThinkingShimmer` 升级为过程区（状态 + tool 步骤列表）。

决策标记剥离、忍住卡、内联 outcome 控件行为不变。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 未登录 / thread 不属于用户 | HTTP 401/404，不进 SSE 体 |
| 单个 tool 执行失败 | 结果回给模型；发该 tool 的 `completed`；不发 SSE `error` |
| 中立策略校验失败 | SSE `error`；不落 assistant |
| Agent / Provider 不可用 | SSE `error` 或连接级 503；user 已存，assistant 不落 |
| 流中断（网络） | 客户端提示；**仅 `done` 后落库**，半截不落 |
| `bind` 失败 | tool 失败回给模型；本回合 `evaluation_id` 为 null；不新建评估行 |

不再依赖「解析失败 → 强制改走 GeneralChat」的服务端分支；由 agent 在 tool 失败后自行用自然语言回复。GeneralChat 专用 503 语义收拢为「对话 Agent 不可用」。

## 明确不做

- 不把过程步骤写入 `agent_messages` 或长期记忆
- 不删除旧 `/agent/chat`、旧购买相关 HTTP 路由与 `PurchaseEvaluationWorkflow`（本期可闲置）
- 不让模型直接改 `user_choice`、资产或购买结果（写库仅限 `bind_purchase_evaluation`）
- 本期不做「取消进行中回合」控件
- 不重做抽屉视觉；不把 `(evaluation)` 改名为 `(chat)`

## 实现范围（预期）

- `server/app/ai/workflows/`：新增 `ConversationAgentWorkflow`（prompt + allowlist + stream/run）
- `server/app/ai/tools/`：识品三件套 + `bind_purchase_evaluation`；复用购买只读 tools
- `server/app/agent_turn.py` 或后继模块：薄封装（校验 thread、注入 context、收集 bind 的 evaluation_id）
- `server/app/main.py`：`POST /agent/chat/stream`；同步 `/agent/chat` 改走同一 workflow
- `mobile/src/lib/api.ts`：`streamAgentChat`
- `mobile/src/components/chat-thread.tsx`：过程区 + 流式气泡 + `done` 后落库
- `docs/architecture/chat-module-v1.md`：同步为 tool 化 + 流式

## 验证

- 闲聊：SSE 为 `thinking` → `replying` + deltas → `done`（`evaluation_id` null）；过程区无 tool 或极少 tool
- 发链接/图/商品描述：出现识品 `tool` 事件；进入梳理时可出现资产/市场/历史/bind；`done.evaluation_id` 仅在 bind 成功时非空
- 前端：多步 tool 同时可见；`done` 后过程清空且助手消息落库；有 `evaluation_id` 时忍住卡/决策路径仍可用
- 非法 thread：不进流式正文；中立违规 / provider 挂：`error` 且不落半截 assistant
- 回归：统一线程、抽屉、outcome 控件、记忆页不受影响
