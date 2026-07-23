# Windows PowerShell 启动适配设计

## 目标

让项目可在 Windows PowerShell 中完成环境配置、启动 App 与 API，并保留现有 macOS/Linux 用法。

## 当前问题

- `mobile/package.json` 的 `npm start` 使用 `set -a`、`.` 和 POSIX 行内环境变量，PowerShell 无法执行。
- README 使用 `source`、`.venv/bin/...` 和 `python3`，这些命令不适用于标准 Windows Python 虚拟环境。
- App 的环境变量来自仓库根目录 `.env.local`，迫使启动命令承担加载和变量映射职责。

## 方案

### App 环境

使用 Expo 原生支持的 `mobile/.env.local`。文件字段沿用 `mobile/.env.example`：

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_ADMIN_EMAIL`
- `EXPO_PUBLIC_ADMIN_PASSWORD`

`npm start` 只执行 `expo start --lan`，不再依赖具体 shell，也不增加环境变量工具或自定义启动脚本。

### PowerShell 文档

根 README 增加 Windows PowerShell 命令，覆盖：

1. 拉取 Vercel 环境和执行 Supabase migration。
2. 使用 `py -m venv` 创建服务端虚拟环境。
3. 使用 `.\.venv\Scripts\python.exe -m pip` 安装依赖。
4. 使用 `.\.venv\Scripts\python.exe -m uvicorn` 启动 API。
5. 创建 `mobile/.env.local`、安装依赖并运行 `npm start`。
6. 运行移动端静态检查和服务端测试。

macOS/Linux 命令继续保留，并同步改为使用 `mobile/.env.local`，确保两个平台遵循同一环境布局。

## 错误边界

- README 明确移动端必须提供五个 `EXPO_PUBLIC_*` 字段，避免 Expo 启动成功但运行时缺少配置。
- 数据库 URL 不自动解析 `.env.local`；PowerShell 用户显式从已拉取文件设置当前会话变量，避免引入额外依赖或维护自定义 dotenv 解析器。
- 服务端仍从 `server/.env` 读取配置，现有运行逻辑不变。

## 验证

- `package.json` 中不再包含 POSIX shell 语法。
- Expo CLI 能从 `mobile/` 目录执行新的 `npm start` 命令。
- `npm run lint` 和 `npx tsc --noEmit` 通过。
- `python -m pytest -q` 通过。
- README 中 PowerShell 路径使用 `.\.venv\Scripts\...`，macOS/Linux 路径使用 `.venv/bin/...`。

## 不包含

- 不支持传统 CMD 专用命令。
- 不增加 `cross-env`、`dotenv-cli` 或自定义 Node 启动器。
- 不改变 Supabase、Vercel 或服务端的部署方式。
