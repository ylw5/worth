# Worth AI 基建与 Tool 说明

状态：Implemented  
版本：v1.0  
日期：2026-07-25

## 1. 总体架构

```text
FastAPI
  → Workflow：业务 Prompt、输出合同、Tool 白名单
    → AgentRunner：模型路由、Tool 循环、流式输出、限制与用量
      → Provider Adapter：Responses / Chat Completions 协议转换
      → Tool Registry：参数校验、权限注入、执行与结果校验
        → Supabase / Market / Domain Service
```

核心原则：

- 业务代码不直接依赖 OpenAI 或 DeepSeek SDK。
- Workflow 管业务规则，Runner 管执行，Adapter 管供应商协议。
- Tool 是强类型、最小权限、由应用控制的原子能力。
- 能确定性计算的结果不用 AI 自由生成。
- 当前 Tool 全部只读。

## 2. 目录

```text
server/app/ai/
├── contracts.py             # AI 消息、Tool、运行和输出合同
├── errors.py                # 统一错误模型
├── router.py                # 按任务和能力选择模型
├── runner.py                # 同步/流式执行与 Tool 循环
├── factory.py               # Provider、Runner、Workflow 组装
├── providers/
│   ├── openai_responses.py
│   └── chat_completions.py
├── tools/
│   ├── registry.py
│   └── purchase.py
└── workflows/
    ├── purchase_evaluation.py
    ├── text.py
    └── vision.py
```

`openai_service.py`、`deepseek_service.py`、`text_ai.py` 和
`evaluation_tools.py` 暂时作为兼容层保留，不再承载新的生产 AI 能力。

## 3. 核心组件

### 3.1 Contracts

统一合同不包含 Provider SDK 对象，主要包括：

| 合同 | 用途 |
|---|---|
| `AIMessage` | 文本或图片消息 |
| `ToolDefinition` | Tool 名称、描述和严格 JSON Schema |
| `ToolCall` / `ToolResult` | 统一 Tool 调用与结果 |
| `StructuredOutputDefinition` | Pydantic 生成的严格输出 Schema |
| `AgentRunRequest` | Workflow 提交给 Runner 的请求 |
| `AgentRunResult` | 文本、模型、Tool 记录和 token 用量 |
| `RunContext` | 服务端注入的用户、请求和区域信息 |

模型能力分为：

`text`、`vision`、`structured_output`、`tools`、`streaming`、`reasoning`。

Runner 会根据图片、Tool、结构化输出和流式请求自动补充所需能力。

### 3.2 Provider Adapter

| Adapter | 当前用途 |
|---|---|
| `OpenAIResponsesProvider` | AI Gateway；图片、Tool、结构化输出、流式 |
| `ChatCompletionsProvider` | DeepSeek；文本、Tool、JSON mode、流式 |

Adapter 只做协议转换、响应解析和原生错误映射，不包含 Worth 业务 Prompt。

### 3.3 Model Router

Router 按任务、能力和优先级选择 Model Profile。

| 任务类型 | 首选 | 备用 |
|---|---|---|
| 购物评估 | DeepSeek | AI Gateway |
| 文本 Workflow | DeepSeek | AI Gateway |
| 图片识别 | AI Gateway | 无 |

同步运行只在 `ProviderUnavailableError` 时尝试下一个候选；流式运行当前不做
故障转移。

### 3.4 AgentRunner

Runner 负责：

- 选择模型并生成 Provider 请求。
- 把用户 ID 哈希为 `safety_identifier`。
- 执行 Tool Call 循环。
- 校验 Tool 白名单、调用身份和返回身份。
- 限制 Tool 步数、重复调用和输出大小。
- 汇总 Provider、模型、Tool 记录和 token 用量。
- 输出统一同步结果或流式事件。

购物评估当前限制：

- 最多 3 个 Tool 步骤。
- 相同 Tool 和参数最多重复 2 次。
- 单个 Tool 输出最多 32,000 字符。
- 禁止并行 Tool Call。

### 3.5 统一错误

错误统一继承 `AIFoundationError`，主要分为：

- 配置、路由和能力错误。
- Provider 不可用、协议异常和 incomplete。
- 结构化输出和产品策略错误。
- Tool 参数、越权、执行、输出过大和循环错误。

只有 Provider 暂时不可用和 Tool 执行错误默认标记为可重试。

## 4. Tool Registry

Tool 注册时必须提供：

- 名称和描述。
- Pydantic 输入模型。
- Handler。
- 可选的 Pydantic 输出模型。
- 是否允许本次执行缓存。

执行过程：

```text
检查 Workflow 白名单
  → Pydantic 校验模型参数
  → 注入 RunContext
  → 执行 Handler
  → 校验并序列化结果
  → 返回 ToolResult
```

安全规则：

- `user_id`、Token 和凭证不能成为模型参数。
- Handler 必须使用 `RunContext.user_id` 过滤用户数据。
- 模型只能调用 Workflow 明确分配的 Tool。
- 缓存键包含 Tool、用户 ID 和参数，且只在当前 Executor 生命周期内有效。

## 5. 当前原子 Tool

当前购物评估开放 4 个只读 Tool：

| Tool | 用途 | 数据源 |
|---|---|---|
| `assets_list` | 读取用户指定分类下的已确认资产 | Supabase `assets` |
| `assets_summary` | 统计资产分类和状态分布 | Supabase `assets` |
| `market_price_snapshot` | 获取二手市场有限样本的中位数和价格区间 | 闲鱼市场采样 |
| `evaluation_history_list` | 读取历史评估、用户选择和后续结果 | Supabase `purchase_evaluations` |

关键边界：

- 所有 Supabase 查询都强制使用认证用户 ID。
- 市场结果标记为有限样本，不代表完整实时行情，也不预测涨跌。
- `legacy_ai_decision`、`user_choice`、`outcome_status` 必须分别解释，
  不得互相推断。

## 6. 当前 Workflow

| Workflow | 能力 | Tool | 生产入口 |
|---|---|---|---|
| `PurchaseEvaluationWorkflow` | 购物事实评估、同步/流式 | 4 个只读 Tool | `/purchase-evaluations/*` |
| `ProductClassificationWorkflow` | 商品标题分类 | 无 | `/products/parse` |
| `ProductInterpretationWorkflow` | 商品文本或闲聊判断 | 无 | `/products/normalize-text` |
| `CandidateMatchingWorkflow` | 市场候选匹配 | 无 | `/estimate`、卖出方案估价 |
| `GeneralChatWorkflow` | 普通聊天 | 无 | `/agent/chat` |
| `SellPlanExplanationWorkflow` | 解释确定性卖出组合 | 无 | `/sell-plans/prepare` |
| `AssetRecognitionWorkflow` | 多图资产识别 | 无 | `/analyze` |
| `ProductImageRecognitionWorkflow` | 待购商品图片识别 | 无 | `/products/analyze-images` |

补充说明：

- 结构化文本和图片输出最多校验 2 次。
- 购物评估禁止 AI 替用户决定买或不买。
- 图片、OCR、网页、历史文本和 Tool 结果都视为不受信任数据。
- 卖出组合由确定性算法计算，AI 只能解释，不能改变结果。
- AI 解释失败时，购物评估和卖出方案保留确定性结果。

## 7. 数据与安全边界

已实现：

- Provider 默认 `store=false`。
- 用户 ID 哈希后才发送给 Provider。
- Tool 严格 Schema、白名单和输出限制。
- 认证用户数据由服务端重新读取。
- 购物输出有额外中立策略校验。
- 图片 URL 不拼入文本 Prompt，也不应写入日志。
- 当前无 AI 自动写库 Tool。

尚未实现：

- 持久化 Trace 和统一观测。
- 生产业务评测集。
- 写 Tool 的确认、幂等、审批和审计。
- 流式模型故障转移。
- 动态模型与 Prompt 管理。

## 8. 扩展规范

新增 Tool：

1. 定义职责单一的 Pydantic 输入、输出。
2. Handler 使用 `RunContext` 获取身份。
3. 注册到领域 Tool Registry。
4. 加入目标 Workflow 的最小白名单。
5. Factory 同时配置 definitions 和 executor。
6. 补充参数、越权、输出和失败测试。
7. 写 Tool 上线前必须先具备确认、幂等和审计。

新增 Workflow：

1. 定义任务名、业务 Prompt 和输出合同。
2. 声明所需模型能力和最小 Tool 白名单。
3. 在 Factory 注册兼容 Model Profile。
4. API 只调用 Workflow，不直接调用 Provider SDK。
5. 补充 Workflow、Router、Adapter 和生产路由测试。

## 9. 测试与下一阶段

当前测试覆盖 contracts、Provider、Router、Runner、Tool Registry、购物评估、
文本、图片、卖出解释和生产 API，全部使用离线 Mock，不依赖真实模型 Key。

下一阶段优先级：

1. AI Trace 与脱敏观测。
2. 关键 Workflow 业务评测集。
3. 写 Tool 审批与审计合同。
4. 清理旧兼容 Service。

相关文档：

- [`ai-foundation-v1.md`](ai-foundation-v1.md)
- [`purchase-evaluation-workflow-v1.md`](purchase-evaluation-workflow-v1.md)
- [`text-workflows-v1.md`](text-workflows-v1.md)
- [`vision-workflows-v1.md`](vision-workflows-v1.md)
