# 保存后后台估价设计

## 目标

「保存并估价 / 保存并重新估价」只等待资产保存完成即离开当前页；估价在本 App 会话内后台执行。列表与详情用「估价中 / 待估价 / 价格」区分状态，消除点击后长时间转圈。

本设计仅改客户端流程与会话内存状态，不改服务端 `/estimate`、估值表或 RPC。

## 产品规则

| 规则 | 说明 |
| --- | --- |
| 先保存再估价 | 保存成功后才启动后台估价；保存失败留在当前页 |
| 立刻离开 | 录入页 `replace` 到资产列表；编辑页 `back` |
| 估价中文案 | 该资产 id 在会话 store 中时显示「估价中」 |
| 待估价文案 | 不在 store 且无 `latest_market_price` 时沿用「待估价」 |
| 会话范围 | 杀进程即中断估价；重启后无「估价中」，无价则「待估价」 |
| 估价失败 | 静默清标记，保持「待估价」；不 Toast；可进详情手动刷新 |
| 防重复 | 同一 `assetId` 已在估价中时忽略新的后台启动 |

## 主流程

### 录入页

1. 校验表单与照片状态。
2. `createAsset`。
3. 标记该资产「估价中」→ invalidate 相关 query → `router.replace('/(tabs)/(assets)')`。
4. 后台：`estimateAsset` → `recordValuation` → `finally` 清标记 → invalidate 资产相关 query。

### 编辑页

1. 校验 → 准备照片 → `updateAsset`。
2. 标记「估价中」→ invalidate → `router.back()`。
3. 后台估价同录入页。

按钮 loading 仅覆盖保存阶段，不覆盖估价。

## 状态

新增模块级会话内存 store（`useSyncExternalStore`），维护正在后台估价的 `Set<assetId>`：

```ts
startBackgroundValuation(assetId, input, onSettled): void
useIsValuing(assetId): boolean
useValuingAssetIds(): ReadonlySet<string>
```

- `startBackgroundValuation`：若 id 已在 set 中则 no-op；否则加入 → 跑估价与落库 → `finally` 移除 → 调用 `onSettled`（由调用方 invalidate）。
- 不落库；进程结束即清空。

## 展示

| 条件 | 价格行文案 |
| --- | --- |
| id 在 store 中 | 估价中 |
| 不在 store 且 `latest_market_price === null` | 待估价 |
| 有价格 | 格式化金额 |

改动点：

- `AssetCard`：按上表显示价格行。
- 资产列表汇总「N 件待估价」：仍只统计 `latest_market_price === null`（含估价中），文案不变。
- 资产详情：若该资产在 store 中，参考市价区表现为进行中（与现有 `refreshPending` 对齐）；禁用「刷新价格」，避免与后台估价双开。

## 范围

**改：**

- 录入页、编辑页保存流程
- 后台估价 helper / 会话 store
- `AssetCard` 与详情价区文案 / 禁用

**不改：**

- 服务端 `/estimate`、估值表结构、卖出计划、心愿单
- 手动「刷新价格」成功路径（仅与后台估价互斥）

## 错误与边界

- 保存失败：留页提示，不启动后台估价。
- 估价失败 / 样本不足：静默清「估价中」；卡片为「待估价」。
- 杀进程：后台中断；重启后无进行中标记。

## 测试（手测）

1. 录入保存后应马上进列表，对应卡显示「估价中」，完成后变价格。
2. 断网或估价失败：卡变为「待估价」，资产仍在。
3. 编辑保存后返回，详情/列表「估价中」→ 完成更新。
4. 估价中点详情「刷新价格」应禁用。
