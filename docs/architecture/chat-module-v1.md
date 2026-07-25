# 聊天模块说明 v1

状态：Implemented  
日期：2026-07-25

设计规格：[Agent 对话流式与 Tool 化编排](../superpowers/specs/2026-07-25-agent-chat-streaming-tools-design.md)

## 1. 模块定位

聊天模块同时承载两类对话：

1. **自由聊天**：接住闲聊、情绪表达和开放问题，不强制回到购物流程。
2. **购物评估对话**：围绕具体商品，结合用户已确认资产、历史购买经历和有限市场样本进行多轮事实梳理。

Agent 可以自然引用相关历史，但不替用户决定买或不买，也不会把 AI 分析当成用户选择或真实结果。

用户侧没有「创建评估」或模式切换；购买梳理在服务端静默发生，对客户端仍是同一条连续对话。

## 2. 当前交互流程（Tool 化流式 Agent）

聊天页每轮发送走单一流式入口：服务端由 `ConversationAgentWorkflow` + tools 编排，不再硬编码「闲聊 / 购买梳理 / 降级」分支。

```text
用户输入 → POST /agent/chat/stream（ConversationAgentWorkflow + tools）
  → SSE: status / tool / text_delta / done | error
  → done 后持久化 assistant（有 evaluation_id → saveEvaluationReply）
```

服务端内部：

```text
校验 thread 归属
  → 注入只读记忆快照、本轮 image_urls（若有）
  → AgentRunner.stream（ConversationAgentWorkflow）
  → 映射为 SSE 事件
```

是否识品、是否查资产/市场/历史、是否静默落库，由 agent 按角色自行判断并调用 tools；tool 级失败回给模型自然语言处理，不再依赖「解析失败 → 强制 GeneralChat」的服务端分支。

客户端发送路径：

1. 确保线程（新对话空白，首条消息时创建 `agent_threads`）
2. 可选上传图片，只把 `image_urls` 交给服务端（不做本地识别分流）
3. 持久化用户消息到 `agent_messages`
4. 调用 `POST /agent/chat/stream`（`thread_id`、最近最多 100 条消息、可选 `image_urls`）
5. 过程区展示 `thinking` / 各 tool 步骤与流式正文（**不**写入 `agent_messages`）
6. 仅收到 `done` 后持久化最终助手回复（若返回 `evaluation_id`，经评估回复路径写入，以便同步决定标记与花费决议）

要点：

- 聊天 Tab **不再**调用 `normalize-text` / `parse` / `analyze-images` / `evaluate` / 旧购买 `stream`；这些旧路由仍保留以兼容，但不参与聊天发送链路。
- 同步 `POST /agent/chat` 保留兼容，内部复用同一 workflow 的非流式 `run`；**App 聊天 Tab 只走 stream**。
- `purchase_evaluations` 是静默后端行：agent 调用 `bind_purchase_evaluation` 时挂在当前 `thread_id` 上 upsert/复用，用户看不到「创建评估」步骤。
- 气泡一律写入 `agent_messages`；线程与消息模型与统一线程设计一致（`agent_threads` / `agent_messages`，评估挂 `thread_id`）。
- 商品评估历史通过聊天页抽屉切换；旧详情路由会重定向回聊天页。

## 3. 对话、记忆与结果

| 内容 | 权威数据源 | 说明 |
|---|---|---|
| 自由聊天 | `agent_threads`、`agent_messages` | 用户可有多条线程；新对话空白，首条消息时创建 |
| 购物评估对话 | `agent_threads`、`agent_messages` | 与自由聊天共用同一线程模型；气泡一律写入 `agent_messages` |
| 购物评估结果 | `purchase_evaluations` | 静默结构化行，挂在 `thread_id` 上（1 线程 : N 评估）；非用户可见模式 |
| 跨对话记忆 | `agent_memories` | 当前主要保存结构化购买经历，不保存全部原始聊天为长期记忆 |
| 用户决定与后续 | `user_choice`、`outcome_status`、`purchase_outcome_events` | AI 分析、用户选择、真实结果相互独立 |
| 回访提醒 | `agent_followups` | “再等等”7 天后回访；“买了”30 天后询问使用结果 |

创建或更新购物评估后，数据库会同步对应记忆。用户新增资产时，系统只在
“90 天内、相同子品类、唯一候选”成立时自动关联；关联后，资产的闲置、上架、
卖出等状态会同步到购买结果。

对话 Agent 会读取仍处于启用状态的购买记忆，压缩为事实快照后注入上下文。
模型只在当前话题确实相关时引用一件历史事实，避免档案式罗列和说教。

## 4. 用户控制与安全边界

- “Agent 记忆与回访”页面可以查看待回访事项、忽略提醒和删除记忆。
- 删除记忆实际将 `is_active` 设为 `false`；原始评估、资产和结果记录仍保留。
- 所有业务表启用 RLS，只允许用户访问自己的线程、消息、记忆和评估。
- 购物评估服务端会重新读取认证用户的资产，不信任客户端上传的资产统计。
- AI Tool 为只读（写库仅限 `bind_purchase_evaluation`）；AI 不得直接写入资产、用户选择、购买结果或目标进度。
- 每轮最多提出一个澄清问题，不输出“建议买/不买”等替用户决策的结论。

## 5. 降级与当前边界

- 鉴权/归属错误、Agent/Provider 不可用、中立策略校验失败、持久化失败 → 客户端提示（SSE `error` 或 HTTP 503）；user 已存，assistant 不落。
- 单个 tool 执行失败 → 结果回给模型，发该 tool 的 `completed`；不发 SSE `error`；由 agent 自行用自然语言回复。
- 流中断（网络）→ 客户端提示；**仅 `done` 后落库**，半截不落。
- 旧的 `normalize-text` / `parse` / `evaluate` / `stream` 路由仍可用，但聊天 Tab 不再调用。
- `evaluation_messages` 表仍保留，但新写入路径不再使用。
- 当前长期记忆以购买经历为主，尚未实现对所有自由聊天内容的自动摘要或向量检索。

相关底层说明：
[AI Foundation](ai-foundation-v1.md)、
[Text Workflows](text-workflows-v1.md)、
[Purchase Evaluation Workflow](purchase-evaluation-workflow-v1.md)。
