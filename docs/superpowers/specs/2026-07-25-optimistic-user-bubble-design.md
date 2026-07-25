# 乐观用户气泡设计

## 目标

聊天发送后，**用户气泡立刻出现**，再显示对方「正在思考」与后续过程。当前顺序相反：`sending` 立刻打开过程区，用户消息要等 `createAgentMessage` + 列表刷新后才渲染。

本设计仅改客户端发送 UX，不改服务端 / SSE。建立在已落地的流式对话之上（见 `2026-07-25-agent-chat-streaming-tools-design.md`）。

## 产品规则

| 规则 | 说明 |
| --- | --- |
| 立刻回显 | 点发送后，用户气泡在同一帧意图内出现（不依赖网络） |
| 再显示过程 | 用户气泡下方才是「正在思考」/ tool / 流式助手气泡 |
| 失败保留 | 发送失败时乐观气泡不撤回；底部继续用现有 `sendError` 提示 |
| 无角标 | 不做气泡内「发送中…」状态；成功后由正式消息列表接管 |
| 文字一致 | 气泡内容与将要入库的文案一致：有字用 trim 后正文，纯图用「看看这件商品」 |

## 问题与根因

`ChatThread.send` 在异步建线程 / 上传 / 写库之前就 `setSending(true)`。渲染上：

1. `sending` → 立刻挂载 `AgentProcessPanel`（默认「正在思考」）
2. 用户气泡只来自 `messagesQuery`，需等 `createAgentMessage` + invalidate 完成

因此用户先看到思考，再看到自己的气泡。

## 方案

采用本地 **optimistic pending**（不用 React Query 乐观写入缓存），避免新会话尚无 `threadId` 时的缓存键问题。

### 状态

在 `ChatThread` 增加：

```ts
pendingUserMessage: string | null
```

- 发送开始：与 `setSending(true)`、清空 draft/photos 同时写入 `pendingUserMessage`
- 成功：在 `try` 末尾（`invalidateThread` 之后）置 `null`；`finally` 只关 `sending` / 过程态，**不**清 pending
- 失败：`catch` 保留 pending；`sendError` 照旧
- 切换会话（`threadId` 变化且非 null→id 的建线程过渡）：置 `null`（与 draft 重置一致）
- 新一轮发送开始时：覆盖为新文案

### 渲染顺序

```text
messages（服务端）
  → pending 用户气泡（若需）
  → AgentProcessPanel（sending 或 processSteps）
  → 流式助手气泡（streamingText）
```

### 去重

当 `messages` 末尾已有一条 `role === 'user'` 且 `content === pendingUserMessage` 时，**不渲染** pending，避免入库刷新后双气泡。

判定只看列表最后一条用户消息是否匹配即可；不依赖临时 id。

### 发送时序（不变的网络步骤，仅提前 UI）

```text
点发送
  → 写入 pendingUserMessage，sending=true，清空输入
  →（UI：用户气泡 + 正在思考）
  → ensureThread / 上传图片 / createAgentMessage
  → invalidate → 正式 messages 出现 → pending 因去重或成功清理而不再单独显示
  → streamAgentChat …
  → 成功：try 末尾清 pending；finally 清 process / sending
  → 失败：保留 pending；catch 设 sendError；finally 清 process / sending
```

### 滚动

现有依赖 `messages.length` / `sending` / `streamingText` / `processSteps` 的滚到底逻辑增加对 `pendingUserMessage` 的依赖，保证立刻回显后也能滚到可见。

## 不做

- 不改服务端 API、消息表、SSE 事件
- 不做 pending 图片缩略图（当前气泡本身只展示文字）
- 不做 React Query `setQueryData` 乐观缓存
- 不做失败后「点气泡重试」；用户可看错误后继续输入发送

## 测试要点

- 已有线程：发送后先见用户气泡，再见思考
- 新会话（`threadId === null`）：发送后气泡立刻出现，建线程过程中不闪空
- 入库刷新后不出现两条相同用户气泡
- 写库或 stream 失败：用户气泡仍在，底部有错误
- 切换到另一会话：pending 消失
