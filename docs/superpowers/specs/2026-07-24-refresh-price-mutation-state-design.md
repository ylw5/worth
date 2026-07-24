# 刷新价格跨页面状态保留设计

## 目标

用户在物品详情页点击「刷新价格」后，请求会继续在后台跑完。离开详情页再进入时，界面必须反映该请求的真实状态：仍在进行则显示 loading 并禁止重复点击；已成功则显示最新价格；已失败则显示错误信息。

## 问题

当前详情页用组件内 `useMutation` 驱动「刷新价格」的 pending / error。离开页面会卸载组件，mutation 的 UI 状态丢失。再进入时按钮恢复为可点，即使同一次估价请求仍在进行，或已在后台成功 / 失败。

估价请求本身可以继续完成（React Query mutation 默认不因卸载取消），但成功后的 `invalidateQueries` 若发生在离开期间，用户回来时 query 会按现有缓存策略刷新；失败则完全看不到。

## 方案

在现有 React Query 栈上，为刷新估价 mutation 使用稳定的 `mutationKey`，并从 mutation cache 读取跨挂载的状态。不引入独立 store，不改后端，不做跨杀进程的任务恢复。

### Mutation key

```ts
mutationKey: ['refresh-price', assetId]
```

按物品隔离。A 物品的刷新不影响 B 物品的按钮状态。

### 详情页读取状态

- 用 `useIsMutating({ mutationKey: ['refresh-price', id] })`（或等价）判断是否仍有进行中的刷新，驱动 spinner、禁用按钮。
- 用 `useMutationState` 读取该 key 下最近一次 mutation 的 `error`（以及必要时的 `status`），驱动错误文案。
- `useMutation` 仍负责发起请求与 `onSuccess` 里的 query 失效；发起时检查同一 key 已有 pending 则不再 `mutate()`。

### 成功与失败

- **成功**：沿用现有逻辑，`invalidateQueries` 刷新 `['asset', id]`、`['valuations', id]`、`['assets']`。离开期间完成后，再进入详情页时 query 会拿到新数据，价格与历史列表更新。
- **失败**：错误保留在 mutation cache，再进入时继续展示。错误保留到该物品下次成功刷新或再次发起刷新（新的 mutation 会覆盖观察结果）。不新增全局 toast 或列表角标。

### UI

交互与现有详情页一致：

- pending：按钮内 `ActivityIndicator`，按钮禁用。
- 失败：按钮上方红色错误文案。
- 已卖出物品仍不提供手动刷新（现有行为不变）。

## 边界

- 仅覆盖 App 进程存活期间的页面进出；杀进程 / 冷启动不恢复 in-flight 请求。
- 不新增服务端估价任务或轮询。
- 不在资产列表展示刷新进度。
- 不改变 `/estimate` API 或 `recordValuation` 语义。

## 实现范围

主要改动文件：`mobile/src/app/asset/[id].tsx`。

如有需要，可将 `mutationKey` 抽成小常量，便于详情页的 `useMutation` / `useIsMutating` / `useMutationState` 共用同一 key，避免字符串漂移。
