# 资产图片识别买入信息设计

## 目标

添加/编辑资产时导入或拍摄照片，若画面中有足够证据，自动预填「实际买入日期」和「实际买入价格」；证据不足则留空，用户可改。

建立在已有资产照片识别（`AssetRecognitionWorkflow` → `/analyze`）与买入字段（见 `2026-07-24-asset-purchase-details-design.md`）之上。原先约定「AI 识别返回的买入字段均为空」以本文为准废止。

## 产品规则

| 规则 | 说明 |
| --- | --- |
| 证据：优先成交凭证 | 订单截图、支付记录、发票/小票等明确成交证据可提取 |
| 证据：折中挂价 | 无成交凭证时，仅当价格旁有「实付 / 成交 / 购买」等字样才填价格 |
| 不填 | 商品价签、电商挂价、二手标价、估价截图等非成交价 |
| 字段独立 | 日期与价格可只填其一 |
| 用户保护 | 用户改过的字段后续识别不再覆盖（与名称等字段一致） |
| 无证据 | 返回空，不猜测、不弹错 |
| 范围 | 仅资产识别；不改购物评估的商品图识别 |

## 数据合同

在 `AIAssetRecognition` / `AssetRecognition` 增加可空字段：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `purchase_date` | `string \| null` | `YYYY-MM-DD`；非法或未来日期 → `null` |
| `purchase_price` | `number \| null` | 必须 `> 0`，否则 `null` |

- `AssetInput` 继承同字段，增量识别时把当前买入信息作为待核对上下文传给模型。
- 不改数据库 schema（`assets.purchase_date` / `purchase_price` 已存在）。
- `/estimate` 等其它使用 `AssetInput` 的路径忽略这两项即可。

## Prompt

扩展 `ASSET_RECOGNITION_SYSTEM_PROMPT`：

- 只从可见文字提取买入信息，不猜测。
- 优先订单/支付/发票/小票；否则仅「实付 / 成交 / 购买」等明确字样旁的价格。
- 日期取成交/购买/支付日期，规范为 `YYYY-MM-DD`。
- 价格取实付/成交金额（非划线价；非单独运费，除非画面只有合计实付）。
- 增量补图：`current_asset` 已有买入字段且新图无新证据时，保留当前值。

## 客户端

- `analyzePhotos` 透传服务端 `purchase_date` / `purchase_price`，不再强制置空；`null` → 表单空字符串，价格格式化为可编辑文本。
- `purchase_date` / `purchase_price` 纳入 `ProtectedField` 与 `mergeRecognition`。
- 添加页：识别结果经 `mergeRecognition` 写入表单。
- 编辑页：去掉「永远保留旧买入信息」；改用同一保护字段合并（已有值可被新证据更新，除非用户本轮改过）。
- 保存校验仍走 `parsePurchaseInput`；无新 UI 控件。

## 不做

- 不改购物评估 `ProductImageRecognition` / `ParsedProduct.price` 语义
- 不新增二次模型调用或本地 OCR 启发式
- 不改 DB migration、详情页展示文案（已有买入字段展示）

## 测试要点

- 服务端：合同含可空买入字段；无证据为 `null`；仅日期或仅价格合法；非法值不进入公开响应
- 增量补图：`current_asset` 已有买入信息且新图无证据时保留
- `mergeRecognition`：未保护采用识别值；保护后不覆盖；可只更新一项
- 验收：订单/小票可预填；仅挂价保持空；用户改过后再加图不覆盖；保存与详情行为不变
