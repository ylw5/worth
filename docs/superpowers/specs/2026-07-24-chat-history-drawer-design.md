# 聊天历史侧边栏设计

## 目标

评估首页（对用户呈现为「聊天」）把历史记录从主内容区移入可折叠左侧抽屉。左上角按钮打开/关闭，交互参考移动端 ChatGPT 的历史抽屉，视觉与文案不照抄，并贴合应用现有浅色设计。

用户打开该页不一定是来做购物评估，因此界面文案避免「评估」等任务导向用语。

## 范围

- **仅** `(tabs)/(evaluation)/index` 首页
- 不在评估详情页 `[id]` 提供抽屉
- 不改后端、不改 `purchase_evaluations` 数据模型
- 不引入搜索、多段导航菜单、暗色皮肤，或路由目录重命名

## 方案

使用 `react-native-drawer-layout`（React Navigation 官方抽屉布局）。项目已具备 `react-native-gesture-handler` 与 `react-native-reanimated`；lockfile 中已有该包作为传递依赖，实现时将其提升为 `mobile` 的直接依赖。

### 交互

| 动作 | 行为 |
| --- | --- |
| 左上角菜单按钮 | 切换抽屉开合 |
| 边缘轻扫 / 遮罩点击 | 关闭（库默认能力） |
| 点历史条目 | 关闭抽屉 → `router.push` 到 `/(tabs)/(evaluation)/[id]` |
| 「新聊天」 | 清空 `prompt`、`photos`、`error`、`chatReply`，关闭抽屉 |

### 主界面

- Header 标题改为「聊天」；去掉 large title，左上角放圆形菜单按钮
- 主内容只保留输入区（`EvaluationComposer`）与闲聊回复气泡
- 移除主滚动区内嵌的「最近评估」列表

### 抽屉内容

- 宽度约屏宽的 78–82%
- 顶部：标题「聊天」
- 中部：分区标题「最近」+ 可滚动列表
  - 主行：商品标题（最多两行）
  - 副行：决策文案 · 日期（例如「再等等 · 7月20日」）
  - loading / error / 空态「还没有记录」在抽屉内展示
- 底部固定：「新聊天」按钮

视觉沿用现有 `colors` / `spacing` / `radius`，浅色表面 + 半透明遮罩，不做 ChatGPT 黑底。

### 组件结构

- 新建抽屉内容组件（建议 `ChatHistoryDrawer`）：负责列表渲染、「新聊天」、safe area
- 首页用 `Drawer` 包裹主内容，本地 `open` state 控制开合；`renderDrawerContent` 渲染上述组件
- 历史数据继续使用现有 `listPurchaseEvaluations` 与 query key `['purchase-evaluations']`（内部命名本次不改）

### 文案

| 位置 | 文案 |
| --- | --- |
| 页标题 / 抽屉标题 | 聊天 |
| 历史分区 | 最近 |
| 底部 CTA | 新聊天 |
| 空态 | 还没有记录 |
| Tab 栏 | 本次可不改（仍可显示「评估」）；若顺手统一可改为「聊天」，非必须 |

决策标签仍用现有 `evaluationDecisionLabels`（买 / 不买 / 再等等等），出现在历史副行，不作为页面主标题用语。

## 边界

- 详情页无抽屉；从详情返回首页时抽屉默认关闭
- 「新聊天」不删除服务端记录，只重置本页本地输入态
- 不改 composer 的链接/文字/图片评估能力与闲聊 intent 逻辑
- 不把 `(evaluation)` 路由目录改名为 `(chat)`（已有隐藏的 `(chat)` 路由，避免冲突）

## 实现范围

- `mobile/package.json`：直接依赖 `react-native-drawer-layout`
- `mobile/src/components/chat-history-drawer.tsx`（或同等命名）：抽屉内容
- `mobile/src/app/(tabs)/(evaluation)/index.tsx`：接入 Drawer、改 header、移除内嵌历史
