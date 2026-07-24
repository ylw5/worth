# Purchase Evaluation Workflow v1

状态：Implemented
日期：2026-07-24

## 1. 目标

购物评估从 `evaluation_tools.py` 内的供应商专用工具循环迁移到统一 AI 地基：

```text
PurchaseEvaluation API
  -> PurchaseEvaluationWorkflow
    -> AgentRunner
      -> ModelRouter
        -> Responses / Chat Completions Adapter
      -> RegistryToolExecutor
        -> Supabase / MarketClient
```

`evaluation_tools.py` 暂时保留为旧 `DeepSeekService`、`OpenAIService` 方法的兼容
层；三个生产购物评估接口不再调用其中的 `ToolExecutor`。

## 2. 原子 Tool

| Tool | 数据源 | 输入身份 | 输出边界 |
|---|---|---|---|
| `assets_list` | Supabase `assets` | `RunContext.user_id` | 已确认资产的最小字段 |
| `assets_summary` | Supabase `assets` | `RunContext.user_id` | 分类与状态计数 |
| `market_price_snapshot` | MarketClient | 无用户身份参数 | 来源、采样时间、区间、中位数、样本数 |
| `evaluation_history_list` | Supabase `purchase_evaluations` | `RunContext.user_id` | 历史 AI 字段、用户选择、后续结果分别输出 |

Tool 均为只读。`user_id` 不出现在模型可见的 JSON Schema 中。澄清问题属于
自然语言响应，不再作为伪 Tool。

## 3. Registry 合同

- Tool 名称全局唯一。
- 输入由 Pydantic 模型校验并转换为严格 JSON Schema。
- Workflow 使用显式 allowlist，不可执行 Registry 中的其他 Tool。
- handler 接收已验证参数和服务端 `RunContext`。
- 输出可由 Pydantic 模型再次校验，并统一序列化为 JSON。
- 参数错误、执行错误和未授权 Tool 使用统一 AI 错误模型。
- 只读 Tool 在单次 Runner 生命周期内按用户和参数缓存。

## 4. Workflow 口径

- 只陈述已确认事实、相关历史、市场有限样本和信息缺口。
- 不输出购买建议、`buy/skip` 标记或替用户生成选择。
- `legacy_ai_decision`、`user_choice`、`outcome_status` 始终分离。
- 每轮最多直接提出一个澄清问题。
- 模型不可执行写操作。
- 同步与流式输出都经过中立决策策略校验；流式输出保留短窗口后发送，拦截
  `decision` 标记及明确的购买建议措辞。
- DeepSeek Profile 保持优先级 100；Gateway Profile 为 90。

## 5. API 迁移

- `/purchase-evaluations/evaluate`
- `/purchase-evaluations/chat`
- `/purchase-evaluations/chat/stream`

为保持移动端请求兼容，旧的 `assets`、`matched_assets`、`facts` 字段暂未删除；
服务端不再将其作为权威事实，而是按认证用户重新加载 Supabase 资产并重新计算
匹配与统计。

首屏评估在 AI 不可用时继续回退到确定性事实叙述；聊天接口返回 503；流式接口
通过 SSE 返回稳定错误消息。

## 6. 后续清理

1. 迁移普通聊天的历史读取。
2. 迁移商品文本分类和候选筛选。
3. 移除 `TextAIService` 中旧购物评估方法。
4. 删除 `evaluation_tools.py` 兼容层及旧供应商专用 Tool 循环。
5. 在移动端完成请求合同升级后删除不再可信的旧请求字段。
