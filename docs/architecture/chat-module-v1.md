# 聊天模块说明 v1

状态：Implemented  
日期：2026-07-25

## 1. 模块定位

聊天模块同时承载两类对话：

1. **自由聊天**：接住闲聊、情绪表达和开放问题，不强制回到购物流程。
2. **购物评估对话**：围绕具体商品，结合用户已确认资产、历史购买经历和有限市场样本进行多轮事实梳理。

Agent 可以自然引用相关历史，但不替用户决定买或不买，也不会把 AI 分析当成用户选择或真实结果。

用户侧没有「创建评估」或模式切换；购买梳理在服务端静默发生，对客户端仍是同一条连续对话。

## 2. 当前交互流程（对话优先）

聊天页每轮发送只走单一入口：服务端编排意图、购买梳理与降级。

```text
用户输入 → POST /agent/chat（服务端编排）
  ├─ 闲聊 → GeneralChat
  ├─ 购买梳理 → 静默评估落库 + 梳理回复
  └─ 解析/评估失败 → 同回合降级 GeneralChat
```

客户端发送路径：

1. 确保线程（新对话空白，首条消息时创建 `agent_threads`）
2. 可选上传图片，只把 `image_urls` 交给服务端（不做本地识别分流）
3. 持久化用户消息到 `agent_messages`
4. 调用一次 `POST /agent/chat`（`thread_id`、最近最多 100 条消息、可选 `image_urls`）
5. 持久化助手回复到 `agent_messages`（若返回 `evaluation_id`，经评估回复路径写入，以便同步决定标记与花费决议）

要点：

- 聊天 Tab **不再**调用 `normalize-text` / `parse` / `analyze-images` / `evaluate` / `stream`；这些旧路由仍保留以兼容，但不参与聊天发送链路。
- `purchase_evaluations` 是静默后端行：有商品识别时挂在当前 `thread_id` 上 upsert/复用，用户看不到「创建评估」步骤。
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

自由聊天会读取仍处于启用状态的购买记忆，压缩为事实快照后交给
`GeneralChatWorkflow`。模型只在当前话题确实相关时引用一件历史事实，避免
档案式罗列和说教。

## 4. 用户控制与安全边界

- “Agent 记忆与回访”页面可以查看待回访事项、忽略提醒和删除记忆。
- 删除记忆实际将 `is_active` 设为 `false`；原始评估、资产和结果记录仍保留。
- 所有业务表启用 RLS，只允许用户访问自己的线程、消息、记忆和评估。
- 购物评估服务端会重新读取认证用户的资产，不信任客户端上传的资产统计。
- AI Tool 为只读；AI 不得直接写入资产、用户选择、购买结果或目标进度。
- 每轮最多提出一个澄清问题，不输出“建议买/不买”等替用户决策的结论。

## 5. 降级与当前边界

- 解析/识别/购买梳理任一步失败时，**同一回合内**降级为 `GeneralChat` 回复（HTTP 200），不向聊天客户端抛「商品描述暂时无法解析」类断聊错误。
- 仅认证失败、错误线程、GeneralChat 不可用或持久化失败会向客户端暴露错误（如 503）。
- 旧的 `normalize-text` / `parse` / `evaluate` / `stream` 路由仍可用，但聊天 Tab 不再调用；本迭代无流式 agent turn。
- `evaluation_messages` 表仍保留，但新写入路径不再使用。
- 当前长期记忆以购买经历为主，尚未实现对所有自由聊天内容的自动摘要或向量检索。

相关底层说明：
[AI Foundation](ai-foundation-v1.md)、
[Text Workflows](text-workflows-v1.md)、
[Purchase Evaluation Workflow](purchase-evaluation-workflow-v1.md)。
