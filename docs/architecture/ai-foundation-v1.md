# Worth AI Foundation v1

状态：Frozen  
冻结日期：2026-07-24  
适用范围：`产品需求文档(PRD)v1.0.md` 的 AI 能力与服务端基础设施

## 1. 产品口径

### 1.1 购物前评估

- Agent 是事实陈述与澄清助手，不是购买决策者。
- 允许输出：已确认事实、相关历史、信息缺口、一个澄清问题、用户自行决策后
  的事实性复盘。
- 禁止输出：“建议买”“建议不买”“值得冲”“不要买”以及语义等价的替用户
  决策。
- AI 分析、`user_choice` 和 `outcome_status` 必须分别存储和展示。
- 旧的 `decision=buy|skip` 仅视为待迁移的历史技术字段，不再作为新 AI 输出
  合同。

### 1.2 估价、残值与卖出组合

- 当前行情来自带来源、样本量和时间戳的市场采样，不承诺完整实时行情。
- 年化持有成本、残值曲线和卖出组合是确定性计算，不由语言模型自由生成。
- 不输出市场涨跌预测或“现在应该卖”的判断。
- 反向卖出组合属于 P1；算法产出组合，AI 只能解释已计算结果。

### 1.3 数据与执行边界

- 用户确认后的 Supabase 数据是业务事实源。
- 客户端只提交资源 ID、本轮用户输入和附件引用；服务端按认证用户重新加载
  资产、评估、目标和历史上下文。
- AI 识别结果必须经过用户确认才能进入资产主数据。
- v1 AI Tool 默认只读。未来写 Tool 必须具备显式确认、幂等键、审计记录和
  最小权限。
- 模型不能提供或覆盖 `user_id`、访问令牌、数据源凭证等执行上下文。
- 不记录密钥、短期签名 URL、完整网页 HTML 或模型隐式推理过程。

## 2. 技术口径

### 2.1 分层

```text
Workflow
  -> AgentRunner
    -> ProviderAdapter
    -> ToolExecutor
      -> Domain services / Supabase / Market source
```

- Workflow 定义业务提示、Tool allowlist、输出合同和模型能力要求。
- AgentRunner 负责统一 Tool 循环、步数限制、重复调用保护、流式事件和用量汇总。
- ProviderAdapter 只负责供应商协议转换，不包含 Worth 业务提示或业务查询。
- ModelRouter 按能力与任务选择已配置模型，不以“某个 Key 是否存在”直接决定
  全部文本任务的供应商。
- AgentRunner 会从图片消息和 `reasoning_effort` 自动补充 `vision`、
  `reasoning` 能力要求，避免调用方漏标后路由到不兼容模型。
- Tool 参数使用严格 JSON Schema；执行身份和已知资源 ID 由服务端注入。

### 2.2 Provider

- OpenAI/Vercel Gateway 使用 Responses API，保留完整 response output 作为
  Tool 循环 continuation，以便 reasoning item 与 function call 正确续接。
- DeepSeek 等 OpenAI-compatible 服务使用 Chat Completions Adapter。
- Chat Completions 的 `strict` Tool 参数默认不发送；仅在供应商及其端点明确
  支持严格模式时通过 Adapter 配置启用。
- Chat Completions 的推理强度字段必须显式配置映射；未配置时拒绝请求，不做
  静默降级。
- 产品会话仍由 Supabase 持久化；Provider 请求默认 `store=false`。
- Provider 的失败、未完成、协议拒绝及原生异常必须转换为统一、可判断是否
  重试的 AI 错误；401/403/404 归为配置错误，408/409/429 与 5xx 归为可重试
  的供应商不可用。
- Tool 输出进入下一轮模型上下文前必须通过长度上限校验，防止上下文膨胀。

### 2.3 v1 不包含

- 现有业务 Workflow 全量迁移。
- 自动写入资产状态、出售记录、目标进度或用户选择。
- Agents SDK、多 Agent handoff、MCP、向量数据库和自动长对话摘要。
- Prompt/模型在线管理后台、自动模型调参或自动切换生产流量。

## 3. 本阶段验收

- 存在独立 `server/app/ai/` 包，旧业务 API 可继续运行。
- contracts 不暴露 OpenAI 或 DeepSeek SDK 对象。
- OpenAI Responses 与 Chat Completions Adapter 实现相同 Provider 协议。
- ModelRouter 能按 `vision`、`structured_output`、`tools`、`streaming` 等能力
  选择模型，并对不满足能力的显式选择失败。
- AgentRunner 支持零个、一个或多个 Tool Call，保留 Provider continuation，
  达到最大步数或重复调用时明确失败。
- 同步与流式运行产生统一事件与最终结果。
- 单元测试不访问外网，不要求真实模型密钥。

## 4. 后续迁移顺序

1. ~~把现有 `evaluation_tools.py` 迁入 Tool Registry。~~ 已完成生产路径迁移，
   旧文件暂作兼容层。
2. ~~迁移购物评估并移除 AI `buy/skip` 输出。~~ 已完成，详见
   [`purchase-evaluation-workflow-v1.md`](purchase-evaluation-workflow-v1.md)。
3. 迁移商品文本分类、普通聊天和候选筛选。
4. 迁移资产/商品图片识别。
5. 接入运行 Trace、业务评测集和写 Tool 审批。
