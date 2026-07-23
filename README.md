# Worth

Worth 是一个使用 Expo 构建的个人实体资产管理 App。拍摄一件物品后，服务端使用 AI 提取资产信息；用户确认后保存，并获取当前参考市价。资产、照片和估价历史通过 Supabase 在 iOS 与 Android 间同步。

## 目录

- `mobile/`：Expo SDK 57 App。
- `server/`：FastAPI 识图与市场估价服务。
- `supabase/migrations/`：数据库、RLS、私有图片存储和估价事务。
- `docs/superpowers/`：已批准的设计与实施计划。

## 1. 配置 Supabase 与管理员

当前开发资源由 Vercel Marketplace 的 Supabase 集成托管。App 没有注册、登录或退出页面，启动时使用本机环境变量中的固定管理员自动登录。

首次配置：

```bash
vercel link
vercel integration add supabase
vercel env pull .env.local --environment=development --yes

source .env.local
npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING" --include-all
```

固定管理员凭据保存在 Vercel 环境变量 `EXPO_PUBLIC_ADMIN_EMAIL` 和 `EXPO_PUBLIC_ADMIN_PASSWORD`。这是仅供个人局域网 MVP 使用的临时方案；公开发布前必须更换正式认证。

## 2. 配置 API

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..
vercel env pull server/.env --environment=development --yes
```

API 通过 Vercel AI Gateway 调用 OpenAI Responses API：

```dotenv
AI_GATEWAY_API_KEY=
OPENAI_MODEL=openai/gpt-5.4
SUPABASE_URL=
SUPABASE_ANON_KEY=
XIANYU_COOKIE=
```

`XIANYU_COOKIE` 只存在于服务端。可使用参考项目 `https://github.com/ylw5/XianYuApis` 的 `qrcode_login()` 完成运营侧扫码登录，再把完整 Cookie 写入服务端机密环境变量。App 中没有数据源名称、连接状态或扫码入口。

启动 API：

```bash
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 3. 启动 App

```bash
cd mobile
npm install
source ../.env.local
EXPO_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
EXPO_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
EXPO_PUBLIC_API_URL="http://YOUR_LAN_IP:8000" \
npm start -- --lan
```

手机必须和开发机处于同一 Wi-Fi。用 Expo Go 扫码验证相机、图片上传和私有 Storage。

## 验证

```bash
cd mobile
npm run lint
npx tsc --noEmit

cd ../server
.venv/bin/pytest -q
```

没有服务端市场登录态时，识图、资产保存和同步仍可工作，但不会生成市场估价。
