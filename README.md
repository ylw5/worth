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

macOS / Linux：

```bash
vercel link
vercel integration add supabase
vercel env pull .env.local --environment=development --yes

source .env.local
npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING" --include-all
```

Windows PowerShell：

```powershell
vercel link
vercel integration add supabase
vercel env pull .env.local --environment=development --yes

$worthEnv = Get-Content .env.local | ConvertFrom-StringData
$env:POSTGRES_URL_NON_POOLING = $worthEnv.POSTGRES_URL_NON_POOLING.Trim('"')
npx supabase db push --db-url $env:POSTGRES_URL_NON_POOLING --include-all
```

固定管理员凭据保存在 Vercel 环境变量 `EXPO_PUBLIC_ADMIN_EMAIL` 和 `EXPO_PUBLIC_ADMIN_PASSWORD`。这是仅供个人局域网 MVP 使用的临时方案；公开发布前必须更换正式认证。

## 2. 配置 API

服务端需要 Python 3.11–3.13；`rembg` 当前不支持 Python 3.10 及以下或 3.14 及以上。

macOS / Linux：

```bash
cd server
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd ..
vercel env pull server/.env --environment=development --yes
```

Windows PowerShell：

```powershell
Set-Location server
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Set-Location ..
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

macOS / Linux：

```bash
cd server
.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Windows PowerShell：

```powershell
Set-Location server
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 3. 启动 App

先在 `mobile/` 下创建 `.env.local`：

macOS / Linux：

```bash
cd mobile
cp .env.example .env.local
```

Windows PowerShell：

```powershell
Set-Location mobile
Copy-Item .env.example .env.local
```

填写以下配置：

```dotenv
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_ADMIN_EMAIL=
EXPO_PUBLIC_ADMIN_PASSWORD=
```

前两个值分别对应根目录 `.env.local` 中的 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。`EXPO_PUBLIC_API_URL` 可以留空，开发环境会从 Expo 自动推导 API 的局域网地址。

然后在 `mobile/` 目录启动：

```bash
npm install
npm start
```

手机必须和开发机处于同一 Wi-Fi。

## 验证

macOS / Linux：

```bash
cd mobile
npm run lint
npx tsc --noEmit

cd ../server
.venv/bin/python -m pytest -q
```

Windows PowerShell：

```powershell
Set-Location mobile
npm run lint
npx tsc --noEmit

Set-Location ..\server
.\.venv\Scripts\python.exe -m pytest -q
```

没有服务端市场登录态时，识图、资产保存和同步仍可工作，但不会生成市场估价。

## Background market analysis

`cloudflare/` runs one daily Workflow per due market key. Set
`SUPABASE_URL` and `CLOUDFLARE_ACCOUNT_ID` in `cloudflare/wrangler.toml`, then
configure these secrets without committing or printing them:

```bash
cd cloudflare
npx wrangler@latest secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler@latest secret put XIANYU_COOKIE
npx wrangler@latest secret put AI_GATEWAY_API_KEY
uv run pywrangler deploy
```

Inspect `analysis_runs` before debugging the mobile UI. Each successful run
stores deduplicated active-listing evidence in `market_snapshots`; it is not
completed-sale data.

The Xianyu endpoint uses authenticated, non-public behavior. If a deployed run
is rejected while the same cookie works locally, keep the database and Workflow
unchanged and move only `cloudflare/src/market.py` behind a stable-egress
collector.

### Residual forecasts

Weekly forecast runs use Bocha Web Search for public evidence and the existing
model only to normalize cited facts. The numeric forecast is calculated by
`cloudflare/src/forecast.py`. The app withholds future values until either four
market dates span 21 days or three verifiable comparable-retention observations
are available.

Configure `BOCHA_API_KEY` as a Cloudflare secret. Search queries contain only
public product identity fields; user identity, notes, photos, purchase price,
and private storage URLs are not sent to Bocha.

### Replacement comparison and backtesting

Replacement comparison assumes the wishlist target price stays constant and
excludes transaction fees. `forecast_backtest_results` compares each matured
6/12-month estimate with a realized sale first, otherwise the nearest market
snapshot within 30 days.

Query matured outcomes with:

```sql
select
  horizon_months,
  count(*) as observations,
  round(avg(absolute_percentage_error), 4)
    as mean_absolute_percentage_error
from public.forecast_backtest_results
where observed_value is not null
group by horizon_months
order by horizon_months;
```

Do not auto-calibrate the model until a category has at least 30 matured
observations for the same horizon. Before that threshold, report error only;
changing coefficients from a handful of outcomes would make the forecast less
stable rather than more accurate.
