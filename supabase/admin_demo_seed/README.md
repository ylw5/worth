# admin@worth.local 演示数据

在 Supabase SQL Editor 中按顺序执行：

1. `01_cleanup.sql`
2. `02_assets.sql`
3. `03_evaluations.sql`
4. `04_messages.sql`
5. `05_funding_and_verify.sql`

每个文件都会自行根据邮箱查找用户 UUID，可以分别执行。

如果中途某一步失败，请修正问题后从 `01_cleanup.sql` 重新开始，以免留下不完整数据。

第一步会删除该账号下的以下资产及其关联数据：

- 智能手机
- 讯飞AI会议耳机（名称中的空格会被忽略）
- 可折叠墨镜
