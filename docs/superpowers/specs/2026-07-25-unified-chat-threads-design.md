# 统一聊天线程设计

## 目标

聊天是唯一历史单位：闲聊与购物评估都发生在同一线程时间线里。评估从用户与 AI 的对话中「长出来」，不再与聊天并列成另一类历史。消息统一存入 `agent_messages`；决策类 UI 只以内联卡片出现在对应气泡下，不使用滚动区顶部固定卡片。

## 范围

- 数据：`agent_threads` / `agent_messages` / `purchase_evaluations` / `spending_resolutions` 及相关 RPC
- 客户端：聊天首页、历史抽屉、线程会话组件（合并现有 general 列表与 `ChatConversation`）
- 迁移：将既有 `evaluation_messages` 与旧评估灌入线程模型
- 不改评估业务规则（决策标记、忍住消费、记忆与回访触发条件）
- 不做向量检索、闲聊自动摘要、删除聊天、抽屉视觉重做
- 不把 `(evaluation)` 路由目录改名为 `(chat)`

## 产品规则

| 规则 | 说明 |
| --- | --- |
| 历史单位 | 仅 `agent_threads`；抽屉「最近」只列线程 |
| 新聊天 | 空白输入区，不建线程；首条消息才创建线程并进历史 |
| 一线程多评估 | 同一会话可先后挂多条 `purchase_evaluations` |
| 分流 | 闲聊走 `/agent/chat`；识别到商品后创建评估并继续在同线程追问 |
| 卡片 | 去掉顶部固定的「你后来怎么选的？」；保留挂在 assistant 气泡下的内联决策卡（含忍住消费）；若仍需记录后来选择，同样改为该结论气泡下的内联操作 |
| 标题 | 默认首条用户消息截断；出现商品评估后可用商品名更新（可选） |

## 数据模型

```text
agent_threads ──1:N── agent_messages
       │
       └──1:N── purchase_evaluations
                    ├── spending_resolutions (message_id → agent_messages)
                    ├── outcome / memory / followups（仍挂评估）
```

### `agent_threads`

- 每用户多条会话；`thread_key` 使用 uuid（不再每用户唯一 `general`）。
- 放宽现有 check：线程可先无评估；不要求 `kind=purchase_evaluation` 才能挂评估（可简化或弱化 `kind`）。
- 停用线程级 `evaluation_id`（一线程多评估后不再有单一挂载点）；关联以 `purchase_evaluations.thread_id` 为准，迁移后可清空或废弃该列。
- `title`、`updated_at` 供抽屉展示；有消息写入时触摸 `updated_at`（沿用现触发器）。

### `agent_messages`

- 线程内全部 user/assistant 气泡的权威存储。
- `route_result` jsonb：标记该轮是否创建/绑定评估、决策解析结果等（至少含可选 `evaluation_id`）。

### `purchase_evaluations`

- 新增 `thread_id`（FK → `agent_threads`，非空（新数据）；迁移后回填）。
- 继续承载产品快照、`decision` / `user_choice` / `outcome_status`、图片路径等结构化结果。
- 同一 `thread_id` 允许多行。

### `spending_resolutions`

- `message_id` 改为指向 `agent_messages.id`（迁移时重映射）。
- `evaluation_id` 仍指向具体评估；一评估最多一条忍住记录的规则不变。

### 废弃写入

- 迁完后停写 `evaluation_messages`；表可先保留为空，本期不硬删。

## 交互

| 动作 | 行为 |
| --- | --- |
| 打开聊天 Tab / 新聊天 | `threadId=null`，空白时间线 + composer |
| 首条消息 | 创建 `agent_threads`，写入消息，抽屉出现该条 |
| 闲聊轮次 | 持久化双向消息到 `agent_messages`，调用 `/agent/chat` |
| 商品轮次 | 在当前线程创建 `purchase_evaluations`；首轮叙事作为 assistant 消息写入；后续追问走评估 stream，仍追加到同线程 |
| 同线程第二件商品 | 再创建一条评估，时间线连续展示 |
| 点历史条目 | 关闭抽屉，打开该 `threadId` 的完整时间线 |
| 记忆/回访深链 | 打开所属线程，滚动到相关消息附近 |

发送时的「当前评估」：新识别到一件商品 → 在该线程新建评估并写入本轮 `route_result.evaluation_id`；后续追问同一商品 → 沿用该 `evaluation_id`；再识别到另一件商品 → 再建一条。页面路由以 `threadId` 为主；旧 `?evaluationId=` / `[id]` 深链解析为所属 `threadId` 后打开线程。

## 客户端结构

- 聊天首页：`Drawer` + 线程会话（单一 `ScrollView` 消息列表 + composer）。
- 抽屉：数据源改为 `listAgentThreads`（按 `updated_at`）；主行标题，副行日期；若线程有评估可附最近决策文案。
- 移除 `ChatConversation` 顶部的 `PurchaseOutcomeControls` 固定块；内联 `SpendingResolutionCard`（及内联后的选择操作）按 `message_id` / `evaluation_id` 挂在对应气泡下。
- 合并现「general 可见窗口」与评估会话：打开已有线程显示全量消息；新聊天在首条前保持空白。

## 服务端与 RPC

- `/agent/chat`、`/purchase-evaluations/evaluate`、stream 可继续无状态；持久化在客户端 + RPC。
- 将 `save_evaluation_reply`（及依赖 `evaluation_messages` 插入的路径）改为写入 `agent_messages`，并维护 `spending_resolutions.message_id`。
- 评估 stream 请求仍带 `evaluation_id`；服务端以产品 + 消息上下文为准（与现状一致）。

## 迁移

一次 SQL 迁移完成：

1. `purchase_evaluations` 增加 `thread_id`（先可空）。
2. 调整 `agent_threads` 约束，支持每用户多会话、线程与评估解耦。
3. 每条旧 `purchase_evaluations`：创建一条线程，迁移其 `evaluation_messages` → `agent_messages`，回填 `thread_id`。
4. 旧唯一 `general` 线程保留为一条历史会话。
5. 重映射 `spending_resolutions.message_id` → 新 `agent_messages.id`。
6. `thread_id` 对新写入非空；应用停写 `evaluation_messages`。

## 实现范围（预期文件）

- `supabase/migrations/*_unified_chat_threads.sql`（含 RPC 调整）
- `mobile/src/lib/agent-chat.ts`、`evaluations.ts`、`spending-resolutions.ts`
- `mobile/src/app/(tabs)/(evaluation)/index.tsx`
- `mobile/src/components/chat-conversation.tsx`（或合并后的线程会话组件）
- `mobile/src/components/chat-history-drawer.tsx`
- `docs/architecture/chat-module-v1.md`（实现后同步「单一线程模型」状态）

## 验证

- 新聊天初始空白；发闲聊后抽屉出现一条线程，可点回继续。
- 同线程先闲聊再谈商品：时间线连续，历史仍一条；再谈第二件商品仍同一历史条目、两条评估。
- 内联决策卡出现在对应 assistant 气泡下；无顶部固定「你后来怎么选的？」卡。
- 忍住消费确认仍只计一次；记忆/回访深链能打开正确线程。
- 旧评估与旧 general 闲聊迁移后可读、可续聊。
