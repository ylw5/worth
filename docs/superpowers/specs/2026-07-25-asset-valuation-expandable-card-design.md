# 资产详情估值可展开卡设计

## 目标

将资产详情页的「当前参考市价」与「市场趋势」合并为一张可展开卡：收起时左侧当前价与区间涨跌、右侧 sparkline；点右侧缩略图展开完整趋势；去掉多余文案与「价格历史」列表。

本设计仅覆盖详情页展示与交互；数据采集与 `market_snapshots` 逻辑仍以 `2026-07-25-daily-market-value-trend-design.md` 为准。其中关于详情「市价卡 + 趋势卡」文案密度、以及估值列表展示的部分，以本文为准。

## 布局

### 收起

- 左：标签「当前参考市价」→ 大号当前价 → 一行区间涨跌（如「30 天 +¥12（+1.4%）」；涨绿跌红）。
- 右：同区间 sparkline（小高度折线）。
- 无行情：左侧价显示「—」，右侧短文案「暂无行情」或空态；无可靠涨跌时副行显示「—」或「行情积累中」。

### 展开

- 顶部仍保留当前价与涨跌摘要；右侧缩略图隐藏，避免与大图重复。
- 中部：平滑面积折线（`react-native-gifted-charts`，`curved` + area）；浅色主题，淡色填充；不画每个拐点圆点；可标最高点 / 最新点价格。
- 图表下方：时间段切换（`30天 / 90天 / 全部`）——选中胶囊、未选中纯文字；再下方居中向上箭头收起。
- 不抄参考图的暗黑霓虹粉光，只学布局层次（图上、筛选下、平滑曲线）。

## 交互

- **展开**：仅点击右侧 sparkline；点击左侧价格/涨跌不展开。
- **收起**：仅点击展开态底部向上箭头；点击时间段、大图或摘要区不收起。
- 切换时间段时涨跌与图表同步更新，保持展开。
- 箭头按钮保证足够 `hitSlop`，便于点按。

## 信息取舍

保留：当前价、区间涨跌、时间段、折线图。

去掉：高低价文案、样本数、数据源说明、常规任务状态（如「已更新」）、页面底部「价格历史」估值列表。

例外：`run.status === 'failed'` 时在摘要下显示一行短危险色提示；queued/running 不常驻文案。

## 组件与范围

- 新建 `MarketValuationCard`（名称可微调），入参现有 `MarketInsight`（snapshots + run）。
- `asset/[id].tsx`：用新卡替换 `MarketSnapshotCard` + `MarketTrendCard`；删除「价格历史」区块及仅为其服务的 `historyQuery`。
- 删除仅被详情使用的 `MarketSnapshotCard` / `MarketTrendCard`。
- 复用 `market-trend.ts`（`filterTrend` / `plotTrend` / `trendStats` / `jobCopy` / `trendChangeCopy`）；展开与缩略图用 `react-native-gifted-charts` 平滑面积图（另需 `react-native-svg`、`expo-linear-gradient`），不改 API。
- 本地状态：`expanded`、`range`（默认 `30d`）、图表宽度。
- `getValuations` 与编辑页对 `valuations` 的 cache invalidate 可保留，详情页不再查询展示。

## 验证

- 收起：左价右缩略图；点左侧不展开，点右侧展开。
- 展开：大图与时间段可用；点箭头收起；切时间段不收起且涨跌同步。
- 时间段位于图表下方；折线平滑且带淡色面积填充。
- 无行情 / 单点 / 刷新失败提示行为符合上文。
- 详情页不再出现高低价·样本·数据源等旧市价卡文案，也不再出现「价格历史」列表。
