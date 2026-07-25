# 手动刷新参考市价设计

## 目标

在资产详情「当前参考市价」标签后提供刷新入口：调用现有估价链路，更新资产最新价，并 upsert 当天 `market_snapshots`，使顶部价格与趋势当日点同时更新。

## 产品规则

| 规则 | 说明 |
| --- | --- |
| 入口 | 「当前参考市价」后跟刷新 icon，不恢复大按钮 |
| 已售 | 不展示刷新 |
| 成功 | 顶部价与当日趋势点同步更新 |
| 样本不足 / 失败 | 不覆盖旧价与旧快照；显示短错误文案 |
| 跨页面状态 | 沿用 `mutationKey: ['refresh-price', assetId]`，进程内存活期间进出详情仍可见 pending/error |

## 数据

扩展 `record_valuation`：

1. 保持现有：插入 `valuations`，更新当前资产 `latest_market_*`。
2. 当价格齐全且 `sample_count >= 5` 时，按上海时区「今天」对同用户、同 `market_key`、未售资产 upsert `market_snapshots`，并同步其 `latest_market_*`。
3. `market_snapshots.run_id` 改为可空；手动刷新不创建 `analysis_runs`。

## UI

- `MarketValuationCard` 接收刷新回调与 pending/error/是否可刷新。
- 详情页负责 mutation、`useIsMutating` / `useMutationState`、query 失效（`asset`、`market-insight`、`assets`）。

## 边界

- 不改 `/estimate` 语义；不触发 Cloudflare 日更任务。
- 杀进程不恢复 in-flight 请求。
