# 纯图标底部导航与聊天入口设计

## 目标

底部导航只显示图标，并预留一个未来用于 Agent Chatbot 的聊天入口。

## 导航

- 现有“资产”“心愿单”“账号”Tab 保持路由和顺序不变，仅隐藏文字标签。
- 在“心愿单”和“账号”之间新增聊天 Tab。
- 聊天图标使用平台原生对话气泡：iOS 为 `bubble.left.fill`，Android 为 `chat_bubble`。
- 使用 Expo NativeTabs 的 `Label hidden` 能力，不自定义 TabBar。

## 页面

- 新增 `(chat)` 路由分组及空白首页。
- 当前不加入聊天 UI、状态或依赖。

## 验证

- 底部导航依次显示资产、心愿单、聊天、账号四个图标，且没有文字。
- 点击聊天图标可进入空白页面。
- Mobile 项目的 TypeScript 和 lint 检查通过。
