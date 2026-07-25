# Text Workflows v1

状态：Implemented
日期：2026-07-24

## 1. 已迁移能力

| Workflow | 生产入口 | 输出 |
|---|---|---|
| ProductClassificationWorkflow | `/products/parse` | `AIProductClassification` |
| ProductInterpretationWorkflow | `/products/normalize-text` | `AIProductInterpretation` |
| CandidateMatchingWorkflow | `/estimate` | 已验证候选 ID 集合 |
| GeneralChatWorkflow | `/agent/chat` | 中立自然语言文本 |

以上入口不再调用 `build_text_ai`、`DeepSeekService` 或 `OpenAIService` 中的旧
文本方法。

## 2. 结构化输出合同

- `StructuredOutputDefinition` 从 Pydantic 输出类型生成严格 JSON Schema。
- Responses Adapter 使用原生 `text.format` JSON Schema。
- DeepSeek Chat Adapter 使用 `response_format=json_object`，随后由应用侧
  Pydantic 合同校验。
- 应用侧校验最多重试两次，仍失败时返回稳定的
  `ai_structured_output_error`。
- 商品解释合同按 `intent` 校验字段组合，候选结果拒绝重复 ID，并保守忽略
  输入集合之外的 ID。
- Workflow 自动声明 `structured_output` 能力，由 ModelRouter 选择兼容
  Profile。

DeepSeek 主端点的 JSON mode 只保证 JSON 可解析，因此这里的
`structured_output` capability 表示端到端能力：Provider JSON 约束加应用侧
Schema 校验，不声称供应商原生支持严格 JSON Schema。

## 3. 产品与安全边界

- 商品标题、用户文本、候选标题和记忆快照均作为不受信任数据传入。
- 分类与解释不得补充输入中不存在的型号、容量或规格。
- 候选筛选不会接受模型创造的 `item_id`；证据不足按不匹配处理。
- 普通聊天不会强行拉回购物；涉及购物时仍不得替用户决定买或不买。
- 商品解释中的 chat reply 与普通聊天结果复用购买中立输出策略。
- 用户身份仅通过 `RunContext` 进入 Runner，不出现在模型输出合同中。

## 4. Provider 路由

- DeepSeek Profile 优先级 100，使用 Chat Completions JSON mode。
- AI Gateway Profile 优先级 90，使用 Responses 原生 JSON Schema。
- 当前保持原有供应商优先级，不在本阶段引入运行时自动故障转移。

## 5. 兼容与后续

`text_ai.py`、`deepseek_service.py` 和 `openai_service.py` 中的旧方法暂时
保留给兼容测试。生产文本与图片入口均已迁入独立 Workflow；确认没有外部
调用方后，可删除旧接口和重复 Prompt。
