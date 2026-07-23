# Worth 固定管理员与 AI Gateway 设计

## 目标

在个人局域网 MVP 中移除可见的注册、登录和退出流程，让 App 启动后自动进入唯一管理员资产库；使用 Supabase CLI 配置数据库，并让现有 Python OpenAI SDK 通过 Vercel AI Gateway 完成图片识别和结构化输出。

## 范围与安全边界

- 仅供所有者个人设备和局域网开发使用，不作为公网发布方案。
- Supabase 管理员邮箱和密码由脚本随机生成，只写入被 Git 忽略的本机环境文件。
- Expo 公共环境变量会进入客户端包，管理员凭据可被提取；公开发布前必须替换为设备激活或正式认证。
- Supabase service role、Vercel AI Gateway Key、OpenAI Key 和市场 Cookie 不进入移动端。

## Supabase

1. 使用 Supabase CLI 登录态查找或创建 `worth` 项目，链接本地目录并执行现有迁移。
2. 通过项目管理凭据创建唯一 Auth 用户 `admin@worth.local`。
3. 将项目 URL、anon key、管理员邮箱和随机密码写入 `mobile/.env.local`。
4. 将项目 URL和 anon key 写入 `server/.env`，服务端继续验证移动端 Supabase access token。
5. 保留现有 RLS、私有 Storage 和 `user_id` 数据隔离，不把 service role 暴露给 App。

## 移动端

- `SessionProvider` 在没有持久会话时调用 `signInWithPassword` 自动登录固定管理员。
- 根路由只等待自动登录结果，然后进入资产列表；删除登录路由。
- 账户页保留管理员状态展示，但移除退出按钮。
- 自动登录失败时展示可重试的配置错误，不循环请求。

## Vercel AI Gateway

- 复用现有 `openai` Python SDK 和 Responses API，不引入新的 AI SDK。
- `OpenAI` 客户端使用 `https://ai-gateway.vercel.sh/v1`，凭据读取 `AI_GATEWAY_API_KEY`。
- 模型使用 Gateway 当前可用且支持 vision、reasoning 和 structured outputs 的 `provider/model` 标识；首选 `openai/gpt-5.4`。
- 从本机已有项目复制密钥到 `server/.env`，不打印或提交密钥。

## 验证

- Supabase CLI migration 状态正常，管理员登录能获得 session。
- 移动端 lint、TypeScript、Expo Doctor 通过。
- 服务端单元测试通过，Gateway 模型列表或最小结构化请求成功。
- Expo Go 在 Android 上可直接进入资产页；真实拍照后可识别、保存并估价。
