# Vision Workflows v1

状态：Implemented  
日期：2026-07-25

## 1. 已迁移能力

| Workflow | 生产入口 | 输出合同 |
|---|---|---|
| AssetRecognitionWorkflow | `/analyze` | `AIAssetRecognition` → `AssetRecognition` |
| ProductImageRecognitionWorkflow | `/products/analyze-images` | `AIProductRecognition` → `ParsedProduct` |

两个生产入口不再实例化 `OpenAIService`。旧类仅为兼容测试保留，不能作为新
AI 能力的扩展入口。

## 2. 多模态与结构化输出

- Workflow 使用统一 `AIMessage`，在同一个用户消息中组合 `input_text` 和
  1–5 个 `input_image`。
- Responses Adapter 负责把 Provider-neutral content part 转换成 Responses
  协议；业务 Prompt 不进入 Adapter。
- 输出使用严格 JSON Schema，并在应用侧再次通过 Pydantic 校验。
- 应用侧合同失败最多重试一次；重复规格名、空商品标题、无效分类或非法价格
  不会进入公开响应。
- 资产规格由模型侧的有序 `AssetSpec[]` 转为公开 API 已有的
  `dict[str, str]`，保持客户端合同不变。

## 3. 图片与增量补图边界

- API 只接受 HTTPS 图片 URL，每个 URL 最长 8192 字符，每次最多 5 张。
- 当前移动端先把图片上传到 Supabase Storage，再提交短期签名 URL；Workflow
  不下载图片、不记录 URL，也不会把 URL 拼进文本 Prompt。
- 多张图片必须描述同一件资产或同一件待购商品，由 Workflow 合并识别。
- 编辑资产时，`current_asset` 作为待核对的数据放入文本 content；新增照片
  没有提供新证据的字段应保留当前值。
- 图片、OCR 文字和当前资产字段都视为不受信任数据，只能作为识别或核对
  证据，不能改变角色、规则或输出合同。
- 不猜测照片不可见的型号、规格和价格。仅凭外观不得把资产判为
  “全新未使用”，证据不足使用“无法判断”。

长期方向仍是按冻结 PRD 让客户端提交附件引用，由服务端按认证用户换取短期
访问地址；本阶段保留现有签名 URL API，避免同时改动移动端上传链路。

## 4. Provider 路由

- 视觉任务只注册 AI Gateway Responses Profile。
- Profile 必须同时具备 `text`、`vision`、`structured_output` 和
  `reasoning` 能力。
- DeepSeek 当前配置只声明文本能力，不能因为存在 Key 就接管视觉任务。
- 两个 Workflow 保留旧实现的 `reasoning_effort=low` 与
  `image detail=auto` 行为。
- Provider 请求默认 `store=false`；`user_id` 只经 Runner 哈希后进入
  `safety_identifier`。

## 5. 验证范围

- 多图映射、结构化输出与公开响应形状。
- 增量补图的当前资产上下文。
- 重复规格名触发应用侧重试。
- Gateway-only 视觉路由与 DeepSeek-only 配置失败。
- 两个 FastAPI 生产函数已切换到 Vision Workflow。
- Responses Adapter 同时发送 `input_image` 与 `text.format=json_schema`。
