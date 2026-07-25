# Agent 查看心愿 Tool 设计

## 目标

为现有对话 Agent 增加一个只读 `wishlist_list` tool。Agent 可按对话需要查看用户全部、待实现或已实现的心愿。

## Tool 契约

输入：

- `status`: `all | active | fulfilled`，默认 `all`

输出按 `created_at` 倒序，每项包含：

- `id`
- `name`
- `target_price`
- `notes`
- `actual_price`
- `fulfilled_at`
- `created_at`

`active` 对应 `fulfilled_at is null`；`fulfilled` 对应 `fulfilled_at is not null`。

## 数据与安全

- 查询现有 `wishlist_items`，不新增表、迁移或移动端数据方法。
- `user_id` 只取自服务端 `RunContext`，模型不能传入身份。
- 查询显式使用当前 `user_id` 过滤，不仅依赖 RLS。
- Tool 只读，不创建、修改、删除或实现心愿。

## Agent 接入

- 将 `wishlist_list` 注册到现有 conversation tool registry 和白名单。
- System prompt 指引 Agent 仅在用户的心愿与当前对话有关时调用，并按需选择状态。
- SSE tool 标签显示为「查看心愿」。
- 暂不支持关键词搜索、分页、资金来源明细或心愿写操作。

## 错误处理

沿用现有 tool 执行机制：参数由 Pydantic 校验；数据库异常包装为 tool 执行失败并交由 Agent 自然处理，不改变整个对话接口。

## 验证

- Tool 定义包含默认 `all` 和三个合法状态。
- 查询始终过滤当前 `user_id`，并按状态追加正确条件。
- 输出同时覆盖待实现和已实现字段。
- conversation workflow 白名单、prompt 和 SSE 中文标签包含该 tool。
