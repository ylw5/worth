# 资产详情参考市价刷新设计

## 目标

在详情页 `MarketValuationCard` 的「当前参考市价」标签旁增加刷新入口，点击后触发与编辑页一致的估价流程，成功后静默更新展示；失败时在卡内显示短错误文案。

本设计是对 `2026-07-25-asset-valuation-expandable-card-design.md` 的增量；展开/收起与趋势图交互不变。

## 布局与交互

- 「当前参考市价」标签与刷新 icon 同一行：标签左、icon 紧随其后（`arrow.clockwise` / Material `refresh`）。
- 点击 icon：发起估价；进行中 icon 转圈、按钮禁用。
- 点击刷新不触发展开/收起；展开态与收起态均可点。
- 失败：在涨跌行下方显示一行短危险色提示（与现有 `run.status === 'failed'` 同级样式）；文案优先用错误信息，否则「估价失败，请稍后重试」。
- 再次点击刷新或成功时清除该提示。
- 成功：不额外成功文案；价格与相关 query 更新即可。

## 当前价数据源

卡同时接收 `asset` 与 `insight`：

- **当前参考市价**：优先 `asset.latest_market_price`；为 `null` 时回退 `insight.snapshots` 最新点；皆无则「—」。
- **涨跌 / 趋势图**：仍只来自 `insight.snapshots`（与可展开卡设计一致）。

这样手动估价写入 `assets.latest_*` 后，刷新成功即可立刻反映在当前价上，无需等待 `market_snapshots` 日更任务。

## 数据流与组件边界

- `MarketValuationCard` 入参：`asset: Asset`、`insight: MarketInsight`。
- 卡内 `useMutation`：`estimateAsset(asset)` → `recordValuation(asset.id, result)`（与编辑页「保存并重新估价」同一链路；不改 API / 服务端）。
- `onSuccess`：`invalidateQueries` — `['asset', id]`、`['market-insight', id]`、`['valuations', id]`、`['assets']`。
- 失败不吞异常：mutation `onError` 写入本地 `refreshError` 字符串供展示；不用 `tryValuation`（其会吞错且无文案）。
- 详情页：`<MarketValuationCard asset={asset} insight={insightQuery.data} />`；pending / 错误态由卡自管。

## 范围外

- 不改 `record_valuation`、不在此任务写入 `market_snapshots`。
- 不新增独立刷新组件；不改编辑页按钮文案与流程。

## 验证

- 标签旁有刷新 icon；点击后转圈且禁用。
- 成功后当前价更新（来自 asset），错误提示消失；趋势区行为不变。
- 失败时出现短危险色提示；再点刷新时提示清除并重新请求。
- 点左侧价/涨跌不展开；点 sparkline 仍展开；点刷新不展开/收起。
