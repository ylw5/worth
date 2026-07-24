# 单页增量照片导入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把拍照导入与确认合并为一个页面，让每张照片依次完成增量识别和主体抠图，并保护用户手动修改过的字段。

**Architecture:** FastAPI 保留 `/analyze` 并加入当前资产上下文，另增 `/cutout` 供独立失败重试。Expo 录入页维护一个最多五张照片的串行队列，识别结果经纯函数合并到未被用户保护的字段；原图和抠图通过 JSON 路径映射持久化到 Supabase。

**Tech Stack:** Python 3.11、FastAPI、Pydantic、OpenAI Responses API、requests、Pillow、rembg 2.0.77 CPU、Expo SDK 57、React Native、TypeScript、Supabase Postgres/Storage。

## Global Constraints

- 拍照逐张添加；相册多选后严格逐张处理，同一时间只有一张处理中。
- 每张照片分别执行识别和抠图；重试只执行失败项。
- AI 不得覆盖用户手动修改过的字段；规格作为一个整体保护。
- 抠图失败不阻止保存，识别失败阻止保存。
- 抠图最长边为 1024px，只下载与 `SUPABASE_URL` 同源且不超过 10MB 的图片。
- 详情页继续展示原图；录入缩略图和资产卡片优先展示抠图。
- 不增加任务队列框架、原生模块、第三方收费 API 或历史批量回填。
- `mobile/src/app/(tabs)/(assets)/index.tsx` 和 `mobile/src/components/asset-card.tsx` 当前有用户未提交修改，必须保留并避免整文件暂存。

---

### Task 1: 服务端主体抠图

**Files:**
- Create: `server/app/background_removal.py`
- Create: `server/tests/test_background_removal.py`
- Modify: `server/requirements.txt`
- Modify: `README.md`

**Interfaces:**
- Produces: `try_remove_background(image_url: str, supabase_url: str) -> str | None`

- [ ] **Step 1: 写失败测试**

`server/tests/test_background_removal.py`：

```python
import base64
from io import BytesIO
from unittest.mock import Mock

from app import background_removal
from PIL import Image


def jpeg_bytes(size=(1600, 800)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "white").save(output, "JPEG")
    return output.getvalue()


def test_rejects_non_supabase_origin(monkeypatch) -> None:
    get = Mock()
    monkeypatch.setattr(background_removal.requests, "get", get)
    assert background_removal.try_remove_background(
        "https://attacker.example/a.jpg",
        "https://project.supabase.co",
    ) is None
    get.assert_not_called()


def test_resizes_and_returns_png(monkeypatch) -> None:
    monkeypatch.setattr(
        background_removal, "_download_image", lambda *_: jpeg_bytes()
    )
    monkeypatch.setattr(background_removal, "_session", lambda: object())
    seen = {}

    def fake_remove(image, session):
        seen["size"] = image.size
        result = image.convert("RGBA")
        result.putalpha(128)
        return result

    monkeypatch.setattr(background_removal, "remove", fake_remove)
    encoded = background_removal.try_remove_background(
        "https://project.supabase.co/storage/a.jpg",
        "https://project.supabase.co",
    )
    assert seen["size"] == (1024, 512)
    assert encoded is not None
    assert base64.b64decode(encoded).startswith(b"\x89PNG\r\n\x1a\n")


def test_failure_returns_none(monkeypatch) -> None:
    monkeypatch.setattr(
        background_removal, "_download_image", lambda *_: jpeg_bytes((10, 10))
    )
    monkeypatch.setattr(
        background_removal,
        "_session",
        Mock(side_effect=RuntimeError("model unavailable")),
    )
    assert background_removal.try_remove_background(
        "https://project.supabase.co/storage/a.jpg",
        "https://project.supabase.co",
    ) is None
```

- [ ] **Step 2: 切换到 Python 3.11 并确认失败**

```bash
cd server
worth_venv_backup="$(mktemp -d)/.venv"
mv .venv "$worth_venv_backup"
echo "$worth_venv_backup"
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pytest tests/test_background_removal.py -q
```

Expected: FAIL，因为抠图模块尚不存在。

- [ ] **Step 3: 加入依赖与版本说明**

`server/requirements.txt` 加入：

```text
rembg[cpu]>=2.0.77,<3
```

README 明确 Python 3.11–3.13，并把环境创建命令分别改为：

```bash
python3.11 -m venv .venv
```

```powershell
py -3.11 -m venv .venv
```

然后安装：

```bash
cd server
.venv/bin/python -m pip install -r requirements.txt
```

- [ ] **Step 4: 实现抠图模块**

`server/app/background_removal.py`：

```python
import base64
import logging
from functools import lru_cache
from io import BytesIO
from urllib.parse import urlparse

import requests
from PIL import Image, ImageOps
from rembg import new_session, remove


logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_COVER_EDGE = 1024


@lru_cache
def _session():
    return new_session()


def _download_image(image_url: str, supabase_url: str) -> bytes:
    image_origin = urlparse(image_url)
    allowed_origin = urlparse(supabase_url)
    if (
        image_origin.scheme not in {"http", "https"}
        or image_origin.scheme != allowed_origin.scheme
        or image_origin.netloc != allowed_origin.netloc
    ):
        raise ValueError("Image must use the configured Supabase origin")

    with requests.get(
        image_url, stream=True, timeout=20, allow_redirects=False
    ) as response:
        response.raise_for_status()
        if not response.headers.get("content-type", "").startswith("image/"):
            raise ValueError("Source is not an image")
        chunks = []
        size = 0
        for chunk in response.iter_content(64 * 1024):
            size += len(chunk)
            if size > MAX_IMAGE_BYTES:
                raise ValueError("Source image is too large")
            chunks.append(chunk)
    return b"".join(chunks)


def _remove_background(image_url: str, supabase_url: str) -> str:
    with Image.open(BytesIO(_download_image(image_url, supabase_url))) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail(
            (MAX_COVER_EDGE, MAX_COVER_EDGE),
            Image.Resampling.LANCZOS,
        )
        cutout = remove(image, session=_session()).convert("RGBA")
    if cutout.getchannel("A").getbbox() is None:
        raise ValueError("Background removal returned no subject")
    output = BytesIO()
    cutout.save(output, "PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def try_remove_background(
    image_url: str, supabase_url: str
) -> str | None:
    try:
        return _remove_background(image_url, supabase_url)
    except Exception:
        logger.exception("Background removal failed")
        return None
```

- [ ] **Step 5: 验证并提交**

```bash
cd server
.venv/bin/python -m pytest tests/test_background_removal.py -q
cd ..
git add README.md server/requirements.txt server/app/background_removal.py server/tests/test_background_removal.py
git commit -m "feat: add photo background removal"
```

Expected: `3 passed`，提交成功。

---

### Task 2: 增量识别上下文与独立抠图接口

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/openai_service.py`
- Modify: `server/app/main.py`
- Modify: `server/tests/test_openai_service.py`

**Interfaces:**
- Produces:
  - `AnalyzeRequest.current_asset: AssetInput | None`
  - `CutoutRequest.image_url: str`
  - `CutoutResponse.image_base64: str | None`
  - `OpenAIService.analyze(image_urls, user_id, current_asset=None)`

- [ ] **Step 1: 增加失败测试**

在 `server/tests/test_openai_service.py` 中：

```python
def test_analyze_includes_current_asset_context() -> None:
    parsed = AIAssetRecognition(
        name="相机",
        brand="富士",
        model="X100VI",
        specs=[],
        category="数码",
        condition="轻微使用痕迹",
        search_query="富士 X100VI",
    )
    current = AssetRecognition(
        name="相机",
        category="数码",
        condition="无法判断",
        search_query="相机",
    )
    service = object.__new__(OpenAIService)
    service.client = Mock()
    service.client.responses.parse.return_value.output_parsed = parsed
    service.model = "test-model"

    service.analyze(["https://example.com/back.jpg"], "user", current)

    text = service.client.responses.parse.call_args.kwargs[
        "input"
    ][1]["content"][0]["text"]
    assert '"name": "相机"' in text
    assert "根据这张新增照片补充或修正" in text
```

新增端点测试，依赖覆盖认证并 mock 抠图：

```python
from fastapi.testclient import TestClient

from app.auth import require_user
from app.main import app


def test_cutout_returns_optional_png(monkeypatch) -> None:
    cutout = Mock(return_value="png-base64")
    monkeypatch.setattr("app.main.try_remove_background", cutout)
    monkeypatch.setattr(
        "app.main.get_settings",
        lambda: Mock(supabase_url="https://project.supabase.co"),
    )
    app.dependency_overrides[require_user] = lambda: "user"
    try:
        response = TestClient(app).post(
            "/cutout",
            json={"image_url": "https://project.supabase.co/a.jpg"},
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json() == {"image_base64": "png-base64"}
```

- [ ] **Step 2: 确认测试失败**

```bash
cd server
.venv/bin/python -m pytest tests/test_openai_service.py -q
```

Expected: FAIL，因为上下文参数和 `/cutout` 尚不存在。

- [ ] **Step 3: 扩展模型**

`server/app/models.py`：

```python
class AssetInput(AssetRecognition):
    pass


class AnalyzeRequest(BaseModel):
    image_urls: list[str] = Field(min_length=1, max_length=5)
    current_asset: Optional[AssetInput] = None


class CutoutRequest(BaseModel):
    image_url: str


class CutoutResponse(BaseModel):
    image_base64: Optional[str] = None
```

把 `AssetInput` 移到 `AnalyzeRequest` 之前，避免前向引用歧义。

- [ ] **Step 4: 把当前资产加入识别提示**

`OpenAIService.analyze` 改为：

```python
def analyze(
    self,
    image_urls: list[str],
    user_id: str,
    current_asset: AssetInput | None = None,
) -> AssetRecognition:
```

用户文本改为：

```python
text = (
    "这些照片是同一件资产，请合并识别。"
    if current_asset is None
    else (
        "当前资产信息如下："
        f"{json.dumps(current_asset.model_dump(), ensure_ascii=False)}。"
        "根据这张新增照片补充或修正完整资产信息。"
    )
)
```

并把原来的固定 `input_text` 文案替换为 `text`。

- [ ] **Step 5: 接入两个路由**

`server/app/main.py`：

```python
from .background_removal import try_remove_background
from .models import (
    AnalyzeRequest,
    AssetInput,
    AssetRecognition,
    CutoutRequest,
    CutoutResponse,
    ValuationResult,
)
```

识别调用加入：

```python
return OpenAIService(get_settings()).analyze(
    request.image_urls,
    user_id,
    request.current_asset,
)
```

新增：

```python
@app.post("/cutout", response_model=CutoutResponse)
def cutout(
    request: CutoutRequest,
    _: str = Depends(require_user),
) -> CutoutResponse:
    image = try_remove_background(
        request.image_url,
        get_settings().supabase_url,
    )
    return CutoutResponse(image_base64=image)
```

- [ ] **Step 6: 验证并提交**

```bash
cd server
.venv/bin/python -m pytest -q
cd ..
git add server/app/models.py server/app/openai_service.py server/app/main.py server/tests/test_openai_service.py
git commit -m "feat: analyze photos incrementally"
```

Expected: 全部服务端测试 PASS。

---

### Task 3: 客户端纯逻辑与持久化契约

**Files:**
- Create: `mobile/src/lib/incremental-import.ts`
- Create: `mobile/tests/incremental-import.test.mjs`
- Create: `supabase/migrations/202607240005_add_photo_cutout_paths.sql`
- Modify: `mobile/src/types/domain.ts`
- Modify: `mobile/src/lib/photos.ts`
- Modify: `mobile/src/lib/assets.ts`
- Modify: `mobile/src/lib/api.ts`

**Interfaces:**
- Produces:
  - `mergeRecognition(current, incoming, protectedFields)`
  - `getAssetCoverUrl(asset)`
  - `photo_cutout_paths` 和 `photo_cutout_urls`
  - `uploadCover`、`cutoutPhoto`

- [ ] **Step 1: 写纯逻辑失败测试**

`mobile/tests/incremental-import.test.mjs`：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAssetCoverUrl,
  mergeRecognition,
} from '../src/lib/incremental-import.ts';

const current = {
  name: '手动名称',
  brand: '',
  model: '',
  specs: { 颜色: '黑色' },
  category: '其他',
  condition: '无法判断',
  search_query: '',
  purchase_date: '2025-01-01',
  purchase_price: '100',
};

const incoming = {
  name: 'AI 名称',
  brand: '富士',
  model: 'X100VI',
  specs: { 颜色: '银色' },
  category: '数码',
  condition: '轻微使用痕迹',
  search_query: '富士 X100VI',
};

test('merges only fields the user has not protected', () => {
  const merged = mergeRecognition(
    current,
    incoming,
    new Set(['name', 'specs']),
  );
  assert.equal(merged.name, '手动名称');
  assert.equal(merged.brand, '富士');
  assert.deepEqual(merged.specs, { 颜色: '黑色' });
  assert.equal(merged.purchase_date, '2025-01-01');
});

test('selects the current cover cutout and falls back to original', () => {
  assert.equal(
    getAssetCoverUrl({
      photo_paths: ['a.jpg'],
      photo_urls: ['original'],
      photo_cutout_urls: { 'a.jpg': 'cutout' },
    }),
    'cutout',
  );
  assert.equal(
    getAssetCoverUrl({
      photo_paths: ['b.jpg'],
      photo_urls: ['original'],
      photo_cutout_urls: {},
    }),
    'original',
  );
});
```

- [ ] **Step 2: 确认测试失败**

```bash
cd mobile
node --experimental-strip-types --test tests/incremental-import.test.mjs
```

Expected: FAIL，因为模块不存在。

- [ ] **Step 3: 实现纯逻辑**

`mobile/src/lib/incremental-import.ts`：

```ts
import type { Asset, AssetInput } from '@/types/domain';

type Recognition = Omit<AssetInput, 'purchase_date' | 'purchase_price'>;
export type ProtectedField = keyof Recognition;

export function mergeRecognition(
  current: AssetInput,
  incoming: Recognition,
  protectedFields: ReadonlySet<ProtectedField>,
): AssetInput {
  return {
    ...current,
    name: protectedFields.has('name') ? current.name : incoming.name,
    brand: protectedFields.has('brand') ? current.brand : incoming.brand,
    model: protectedFields.has('model') ? current.model : incoming.model,
    specs: protectedFields.has('specs') ? current.specs : incoming.specs,
    category: protectedFields.has('category')
      ? current.category
      : incoming.category,
    condition: protectedFields.has('condition')
      ? current.condition
      : incoming.condition,
    search_query: protectedFields.has('search_query')
      ? current.search_query
      : incoming.search_query,
  };
}

export function getAssetCoverUrl(
  asset: Pick<
    Asset,
    'photo_paths' | 'photo_urls' | 'photo_cutout_urls'
  >,
) {
  const coverPath = asset.photo_paths[0];
  return (
    (coverPath ? asset.photo_cutout_urls?.[coverPath] : undefined) ??
    asset.photo_urls?.[0]
  );
}
```

- [ ] **Step 4: 添加迁移和类型**

`supabase/migrations/202607240005_add_photo_cutout_paths.sql`：

```sql
alter table public.assets
add column photo_cutout_paths jsonb not null default '{}'::jsonb;
```

`Asset` 新增：

```ts
photo_cutout_paths: Record<string, string>;
photo_cutout_urls?: Record<string, string>;
```

`AssetPhoto` 新增：

```ts
export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed';

cutoutPath?: string;
cutoutUrl?: string;
recognitionStatus?: ProcessingStatus;
cutoutStatus?: ProcessingStatus;
```

- [ ] **Step 5: 扩展 Storage 读写**

在 `assets.ts` 提取内部 `uploadImage`，保留 `uploadPhoto` 的 JPEG 行为并新增：

```ts
export const uploadCover = (base64: string, userId: string) =>
  uploadImage(base64, userId, 'png');
```

`withPhotoUrls` 同时签名 `Object.entries(asset.photo_cutout_paths)`，形成 `photo_cutout_urls`。

`createAsset` 新增第四个参数：

```ts
photoCutoutPaths: Record<string, string> = {}
```

并插入 `photo_cutout_paths: photoCutoutPaths`。

`updateAsset` 新增第四个可选参数，在提供时更新 `photo_cutout_paths`。

- [ ] **Step 6: 扩展 API**

`analyzePhotos` 新增可选 `currentAsset`，请求加入：

```ts
current_asset: currentAsset ?? null
```

返回类型保持现有 Recognition。

新增：

```ts
export async function cutoutPhoto(imageUrl: string) {
  const result = await request<{ image_base64: string | null }>(
    '/cutout',
    { image_url: imageUrl },
  );
  return result.image_base64;
}
```

- [ ] **Step 7: 验证并提交干净文件**

```bash
cd mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
cd ..
git add \
  supabase/migrations/202607240005_add_photo_cutout_paths.sql \
  mobile/src/lib/incremental-import.ts \
  mobile/tests/incremental-import.test.mjs \
  mobile/src/types/domain.ts \
  mobile/src/lib/photos.ts \
  mobile/src/lib/assets.ts \
  mobile/src/lib/api.ts
git commit -m "feat: store per-photo cutouts"
```

Expected: 测试和静态检查 PASS，提交不包含用户已有列表/卡片改动。

---

### Task 4: 照片选择器状态与重试

**Files:**
- Modify: `mobile/src/components/asset-photo-picker.tsx`

**Interfaces:**
- Consumes: `AssetPhoto` 的两项处理状态和可选 `cutoutUrl`。
- Produces: `disabled`、`onAdd`、`onRetry`。

- [ ] **Step 1: 调整 props**

```ts
photos: AssetPhoto[];
disabled?: boolean;
onAdd?: (photos: AssetPhoto[]) => void;
onChange: (photos: AssetPhoto[]) => void;
onRetry?: (photo: AssetPhoto) => void;
onError: (message: string) => void;
```

内部 `add` 使用：

```ts
if (onAdd) onAdd(next);
else onChange([...photos, ...next]);
```

这样编辑页在 Task 6 接入新流程前仍保持现有行为。

- [ ] **Step 2: 禁用飞行中交互**

- `Sortable.Grid` 使用 `sortEnabled={!disabled}`。
- 封面、删除和添加按钮使用 `disabled={disabled}`。
- disabled 时按现有样式降至 0.65 opacity。

- [ ] **Step 3: 显示抠图与状态**

图片改为：

```tsx
source={photo.cutoutUrl ?? photo.uri}
contentFit={photo.cutoutUrl ? 'contain' : 'cover'}
```

状态规则：

```ts
function photoStatus(photo: AssetPhoto) {
  if (
    photo.recognitionStatus === 'processing' ||
    photo.cutoutStatus === 'processing'
  ) return '处理中';
  if (
    photo.recognitionStatus === 'failed' &&
    photo.cutoutStatus === 'failed'
  ) return '处理失败';
  if (photo.recognitionStatus === 'failed') return '解析失败';
  if (photo.cutoutStatus === 'failed') return '抠图失败';
  if (
    photo.recognitionStatus === 'succeeded' &&
    photo.cutoutStatus === 'succeeded'
  ) return '已解析';
  return '等待处理';
}
```

失败时底部动作显示“重试”，调用 `onRetry(photo)`；否则显示现有删除动作。

- [ ] **Step 4: 静态验证并提交**

```bash
cd mobile
npx tsc --noEmit
npm run lint
cd ..
git add mobile/src/components/asset-photo-picker.tsx
git commit -m "feat: show photo processing states"
```

Expected: 全部 PASS，现有录入页和编辑页继续兼容。

---

### Task 5: 单页串行处理与保存

**Files:**
- Modify: `mobile/src/app/(tabs)/(capture)/index.tsx`

**Interfaces:**
- Consumes: Tasks 3–4 的合并函数、API、Storage 和选择器。
- Produces: 单页处理队列、字段保护、失败重试、保存与取消清理。

- [ ] **Step 1: 初始化空表单和保护集合**

```ts
const emptyForm: AssetInput = {
  name: '',
  brand: '',
  model: '',
  specs: {},
  category: '其他',
  condition: '无法判断',
  search_query: '',
  purchase_date: '',
  purchase_price: '',
};
```

组件使用 `form`、`specsText`、`protectedFields` ref、`photosRef`、`formRef`、`processing`、`saving` 和 `saved` ref。

用户 `onChange` 时比较 AI 可写字段，把发生变化的字段加入保护集合；规格回调单独加入 `specs`。

- [ ] **Step 2: 实现串行照片处理**

`processPhoto(photoId, retryRecognition, retryCutout)`：

1. 未上传时调用 `uploadPhoto` 并保存 path/signedUrl。
2. 对需要执行的能力使用同一个 `Promise.allSettled`，识别调用 `analyzePhotos([signedUrl], formRef.current)`，抠图调用 `cutoutPhoto(signedUrl)`。
3. 成功后用 `mergeRecognition` 合并，并同步 `specsText`。
4. 抠图返回 Base64 时调用 `uploadCover`。
5. 分别写入两项状态，失败项不抹掉成功项。

`addPhotos(added)` 先把全部新照片标记 pending 并加入状态，然后：

```ts
setProcessing(true);
for (const photo of added) {
  await processPhoto(photo.id, true, true);
}
setProcessing(false);
```

不得使用 `Promise.all` 处理多张照片。

- [ ] **Step 3: 实现单项重试和删除清理**

失败照片重试：

```ts
setProcessing(true);
await processPhoto(
  photo.id,
  photo.recognitionStatus === 'failed',
  photo.cutoutStatus === 'failed',
);
setProcessing(false);
```

照片变更时找出删除项，删除其已上传的原图和抠图路径，再更新状态。处理中由选择器禁用删除。

- [ ] **Step 4: 把表单和保存移入录入页**

复用原确认页的：

- `AssetFormFields`
- `parsePurchaseInput`
- `createAsset`
- `estimateAsset`
- `recordValuation`
- Query invalidation

保存前额外校验：

```ts
const canSave =
  photos.length > 0 &&
  !processing &&
  !saving &&
  photos.every((photo) => photo.recognitionStatus === 'succeeded');

if (!canSave) {
  setError('请等待所有照片解析完成，或重试失败的照片');
  return;
}
```

保存按钮使用 `disabled={!canSave}`。

生成：

```ts
const photoCutoutPaths = Object.fromEntries(
  photos.flatMap((photo) =>
    photo.path && photo.cutoutPath
      ? [[photo.path, photo.cutoutPath]]
      : [],
  ),
);
```

保存后刷新资产列表并 `router.replace('/(tabs)/(assets)')`。

- [ ] **Step 5: 未保存离开时清理**

effect cleanup 从 `photosRef.current` 收集全部 `path` 和 `cutoutPath`。只有 `saved.current` 为 false 时调用 `removePhotos`。

处理或保存期间使用 navigation `beforeRemove` 阻止离开，避免飞行中请求产生孤儿文件。

- [ ] **Step 6: 完成页面结构**

页面顺序：

1. 说明文字。
2. `AssetPhotoPicker`。
3. `AssetFormFields`。
4. 错误文字。
5. “保存并估价”按钮。

不保留“解析照片”按钮，不跳转 `/confirm`。

- [ ] **Step 7: 验证并提交**

```bash
cd mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
cd ..
git add \
  'mobile/src/app/(tabs)/(capture)/index.tsx'
git commit -m "feat: import assets incrementally"
```

Expected: 全部 PASS。

---

### Task 6: 编辑页、卡片和旧确认流清理

**Files:**
- Modify: `mobile/src/app/asset/[id]/edit.tsx`
- Modify: `mobile/src/components/asset-card.tsx`
- Modify: `mobile/src/app/_layout.tsx`
- Delete: `mobile/src/app/confirm.tsx`
- Delete: `mobile/src/providers/draft-provider.tsx`

**Interfaces:**
- Consumes: 每图抠图路径映射和 `getAssetCoverUrl`。
- Produces: 编辑映射维护、卡片抠图优先、单页路由。

- [ ] **Step 1: 让编辑照片携带抠图**

初始化每张照片时加入：

```ts
cutoutPath: asset.photo_cutout_paths[path],
cutoutUrl: asset.photo_cutout_urls?.[path],
recognitionStatus: 'succeeded',
cutoutStatus: asset.photo_cutout_paths[path] ? 'succeeded' : 'failed',
```

新照片在 `previewRecognition` 上传后，对缺少 `cutoutPath` 的照片逐张调用 `/cutout` 并上传 PNG；失败不抛出整个重新解析流程。

- [ ] **Step 2: 保存最终映射并清理删除文件**

从最终 `prepared` 照片生成 `photoCutoutPaths`，作为 `updateAsset` 第四个参数。

保存成功后清理：

- 被删除的原图。
- 被删除原图在旧 `asset.photo_cutout_paths` 中对应的抠图。
- 未进入最终映射的 staged 原图或抠图。

保存失败前不得删除旧文件。

- [ ] **Step 3: 卡片优先抠图**

导入 `getAssetCoverUrl`，仅把图片 source 改为：

```tsx
source={getAssetCoverUrl(asset)}
```

不得改动卡片中用户尚未提交的字号、字重和行高调整，不整文件暂存该文件。

- [ ] **Step 4: 删除确认路由和 Provider**

根布局移除 `DraftProvider` import、包装层和 `confirm` Stack.Screen。

删除：

```text
mobile/src/app/confirm.tsx
mobile/src/providers/draft-provider.tsx
```

- [ ] **Step 5: 完整验证**

```bash
cd mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
cd ../server
.venv/bin/python -m pytest -q
cd ..
git diff --check
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交无冲突文件，保留卡片用户改动**

```bash
git add \
  'mobile/src/app/asset/[id]/edit.tsx' \
  mobile/src/app/_layout.tsx \
  mobile/src/app/confirm.tsx \
  mobile/src/providers/draft-provider.tsx
git commit -m "feat: finish per-photo cutout flow"
git diff --check -- mobile/src/components/asset-card.tsx
```

Expected: 功能提交成功；`asset-card.tsx` 保持未暂存，同时包含用户原改动和一行本功能 source 调整。

---

### Task 7: 数据库和真实流程验证

**Files:**
- Verify only.

- [ ] **Step 1: 应用 Supabase 迁移**

```bash
source .env.local
npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING" --include-all
```

Expected: `202607240005_add_photo_cutout_paths.sql` 成功应用。

- [ ] **Step 2: 启动服务**

```bash
cd server
.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

另一个终端：

```bash
cd mobile
npm start
```

- [ ] **Step 3: 真实交互检查**

1. 从相册选择三张照片，确认严格逐张显示处理状态。
2. 第一张完成后手动改名称和规格，确认后两张不会覆盖。
3. 让一张抠图失败，确认仍可保存且该图回退原图。
4. 让一张识别失败，确认保存被禁用并可只重试识别。
5. 切换封面，确认卡片使用对应照片已有抠图。
6. 打开详情，确认相册仍是原图。
7. 未保存离开一次，确认 Storage 暂存文件被清理。
8. 编辑新增照片并重新解析，确认补做抠图。

- [ ] **Step 4: 最终状态检查**

```bash
git status --short
git diff --check
git log -8 --oneline
```

Expected: 用户原有资产列表和卡片改动保留；本功能无其他未解释改动。
