# 对话优先 Agent 回合设计

## 目标

聊天发送链路收成「对话即一切」：客户端每轮只调用一次 `POST /agent/chat`，不再在本地分流 `normalize-text` / `parse` / `evaluate` / `stream`。不存在用户可见的「创建评估」步骤；AI 根据对话决定是否进入购买梳理。角色维持不替用户拍板。购买链路上任一步解析/评估失败时，同一回合内降级为闲聊回复，不向客户端抛红字断聊。

本设计建立在已落地的统一线程模型之上（`agent_threads` / `agent_messages`，评估挂 `thread_id`）。见 `2026-07-25-unified-chat-threads-design.md`。

## 产品规则

| 规则 | 说明 |
| --- | --- |
| 单一回合入口 | 客户端发送路径：建线程（若需）→ 写 user → `POST /agent/chat` → 写 assistant |
| 无「创建评估」UX | 界面不切换评估模式；无「评估已创建」类提示 |
| AI 角色 | 事实、缺口、每轮至多一个澄清问题；信息够时可带决策标记 / 忍住卡；不替用户拍板 |
| 静默落库 | 仅当本回合真正进入购买梳理且有可识别商品时，后台 upsert `purchase_evaluations` |
| 同回合降级 | 认链接 / 文字归一化 / 识图 / 评估工作流失败 → 同一响应内改走 GeneralChat，不返回解析类 503 给客户端 |
| 真失败 | 仅鉴权失败、GeneralChat 本身不可用、或写库失败时，客户端才提示重试 |

## 目标链路

```text
用户输入（文字 / 链接 / 图）
  → ensureThread
  → agent_messages ← user
  → POST /agent/chat { thread_id, messages, image_urls? }
  → 服务端回合编排（闲聊或购买梳理；失败则降级闲聊）
  → agent_messages ← assistant（含可选决策标记）
  → 内联决策 / 忍住卡（若有）
```

客户端不再调用：

- `/products/normalize-text`
- `/products/parse`
- `/products/analyze-images`（识图改由服务端在回合内调用；客户端只上传拿 URL）
- `/purchase-evaluations/evaluate`
- `/purchase-evaluations/chat/stream`

上述路由本期可保留供兼容，但聊天 Tab 停用。

## API

### 扩展 `POST /agent/chat`

**请求（在现有 `messages` 上增加）：**

| 字段 | 说明 |
| --- | --- |
| `thread_id` | 当前线程；服务端校验归属当前用户 |
| `messages` | 最近上下文，须含本轮 user（最多 100 条，与现约定一致） |
| `image_urls` | 可选；已上传图片的可访问 URL 列表 |

**响应：**

| 字段 | 说明 |
| --- | --- |
| `message` | 助手可见正文（可含隐藏决策标记，客户端按现逻辑解析） |
| `evaluation_id` | 可选；本回合静默落库/绑定的评估 id，供 `route_result` 与内联卡 |

### 服务端回合编排

```text
收到回合（校验 thread_id）
  ├─ 有 image_urls → 尝试识图得到商品线索（失败 → 降级闲聊出口）
  ├─ 否则从最新 user 文本检测链接 → 尝试 parse（失败 → 降级闲聊出口）
  ├─ 否则对文字做意图/商品理解（失败 → 降级闲聊出口）
  ├─ 判定为闲聊或无线索 → GeneralChat（可读记忆）→ 返回 message
  └─ 判定为购买梳理且商品可识别
        → 静默 upsert purchase_evaluations（thread_id）
        → 结合资产/记忆生成梳理回复（首轮或续聊同一套出口）
        → 信息够时附带 [decision:*] / [spending_resolution:*]
        → 返回 message + evaluation_id
```

**同回合降级（解析失败 → 闲聊回复）：**

- 适用：文字归一化、链接解析、识图、评估工作流任一步失败或超时。
- 行为：不向客户端返回「商品描述暂时无法解析」等解析类错误；捕获后调用 GeneralChat，用同一 `messages`（可附简短内部说明：商品细节暂不完整）生成回复并 200 返回。
- 落库：降级回合**不**新建/更新 `purchase_evaluations`。
- 用户感知：正常助手气泡；可用自然语言轻带「链接暂时打不开」等，但不展示技术错误串。

**仍可失败给客户端的情况：** 未登录、thread 不属于用户、GeneralChat 本身 503、持久化失败。

## 客户端

`ChatThread.send` 收成：

1. 无 `threadId` → `createAgentThread`，更新标题与路由。
2. 有图 → 仅 `uploadPhotos` 得到 signed URL（不做 analyze）。
3. `createAgentMessage` 写 user。
4. `chatFreely` / 扩展后的 `POST /agent/chat` 一次调用。
5. 写 assistant（若响应含决策标记，走现有 `save_evaluation_reply` 或等价路径，使忍住卡 `message_id` 正确）；`route_result.evaluation_id` 在有返回时写入。
6. 刷新线程消息 / 评估 / 决议查询。

删除客户端的 normalize / parse / evaluate / stream 分支与「解析失败再 fallback 闲聊」的补丁逻辑（改由服务端同回合降级）。

## 与统一线程模型的关系

- 历史单位仍是 `agent_threads`；气泡仍是 `agent_messages`。
- `purchase_evaluations` 保留为后台结构化结果（记忆、回访、忍住消费），用户无感。
- 内联决策卡、无顶部固定「你后来怎么选的？」卡：保持 `unified-chat-threads` 约定。

## 明确不做

- 不把 AI 改成替用户下「建议买/不买」的强结论角色（决策标记规则沿用现协议，措辞仍是帮用户想清楚）。
- 本期不做流式 agent 回合（后续可加）。
- 不删除旧 HTTP 路由与 `evaluation_messages` 表。
- 不重做抽屉视觉；不把 `(evaluation)` 改名为 `(chat)`。

## 实现范围（预期）

- `server/app/models.py`：扩展 `AgentChatRequest` / `AgentChatResponse`
- `server/app/main.py`（及必要的 workflow/编排模块）：回合编排 + 同回合降级
- `mobile/src/lib/api.ts`：`chatFreely` 请求/响应字段
- `mobile/src/components/chat-thread.tsx`：极简 send
- `docs/architecture/chat-module-v1.md`：同步「对话优先」流程

## 验证

- 发「你好」：一轮闲聊；客户端网络日志无 `normalize-text`。
- 发「我想买佳明手表」且内部认商品失败：仍有助手回复，无红字断聊；无新评估行。
- 发可用商品链接且服务正常：同线程连续对话；后台可有 `purchase_evaluations`；界面无模式切换。
- 结论回合：内联忍住/决策卡仍可用且只确认一次。
- 新聊天空白；首条消息进入抽屉历史。
