# 聊天过程区收起与过滤设计

## 目标

调整聊天回合过程区：不展示「正在回复」；有 tool 的中间过程在本线程会话内保留，挂在对应助手气泡上方，可展开/收起。无 tool 的闲聊结束后过程区消失。

本设计仅改客户端过程区 UX 与本会话内存状态，不改服务端 / SSE / `agent_messages`。建立在已落地的流式对话与乐观用户气泡之上（见 `2026-07-25-agent-chat-streaming-tools-design.md`、`2026-07-25-optimistic-user-bubble-design.md`）。其中关于「`done` 后清空过程区」的约定，以本文为准：有 tool 时改为收起保留，无 tool 时仍清空。

## 产品规则

| 规则 | 说明 |
| --- | --- |
| 不展示「正在回复」 | 忽略 `status: replying`；开始出字后只靠流式/已落库助手气泡 |
| 「正在思考」 | 回合开始、尚无可见 tool 步骤时保留 shimmer |
| Tool 过程 | 进行中全部展开；回合成功结束后默认收起，可再展开 |
| 无 tool | 结束后过程区消失，不写入 completed |
| 保留范围 | 挂在该条助手消息上方；本线程会话内可看；切线程或刷新即丢 |
| 不落库 | 不写 `route_result` / 不扩展 RPC |

## 状态

在 `ChatThread` 增加本会话内存：

```ts
completedProcessByMessageId: Map<string, { name: string; label: string }[]>
```

（实现可用 `Record` 等等价结构。）

- **进行中**：沿用现有 `processSteps`；渲染时过滤掉 `kind: 'status' && status === 'replying'`
- **成功且存在 tool**：从 `processSteps` 抽出 tool（去 phase，只留 name/label，按顺序），在助手消息落库并 `invalidate` 后，按新助手消息 `id` 写入 `completedProcessByMessageId`；清空进行中 `processSteps` / `streamingText`
- **成功但无 tool / 失败**：不写入 completed；照旧清空进行中过程态
- **`threadId` 变化**（含切到另一会话；不含 null→id 建线程过渡）：清空 `completedProcessByMessageId` 与进行中过程态（与 draft / pending 重置一致）

关联消息 id：在 `createAgentMessage` / `saveEvaluationReply` 之后，用返回的 message id，或从刷新后的 `messages` 取本轮新增的最后一条 `role === 'assistant'`。优先用写入 API 的返回值，避免竞态。

## 渲染

### 顺序

```text
messages（每条助手气泡前若有 completed 过程区则先渲染）
  → pending 用户气泡（若需）
  → 进行中 AgentProcessPanel（sending 或 processSteps 有可见项）
  → 流式助手气泡（streamingText）
```

已完成过程区挂在**对应**助手气泡上方，不挂在时间线底部单独一块。

### 进行中 `AgentProcessPanel`

- 无步骤时：默认「正在思考」shimmer（与现逻辑一致）
- 有步骤：按时间排列；跳过 `replying`；最新 `thinking` 可用 shimmer，历史 `thinking` 可静态文案或一并省略（推荐：仅保留最后一个 thinking，且若其后已有 tool 则可不展示 thinking）
- Tool：进行中 / 完成均可见（现有「进行中…」「完成」后缀可保留）

### 已完成过程区

- 默认收起：一行可点摘要，如「已调用 N 个步骤」
- 展开：只列 label（不重复 phase）
- 本地 `expanded` 按消息 id 记忆；切线程后整表清空即可

## 不做

- 不持久化过程步骤到数据库或长期记忆
- 不改 SSE 事件形态（服务端仍可发 `replying`，客户端忽略）
- 不做跨线程 / 冷启动恢复过程区
- 不把过程步骤写入助手正文

## 测试要点

- 闲聊：仅「正在思考」→ 流式正文；结束后无过程区
- 有 tool：进行中展开可见各步骤；不出现「正在回复」；结束后收起摘要在助手气泡上方
- 收起态可展开再收起；摘要文案与步骤数一致
- 同一线程连续多轮：每轮有 tool 的助手气泡上方各自保留
- 切换线程再回来：过程区不恢复（仅正式消息）
- 发送失败：不写入 completed；进行中过程清空；错误提示照旧
