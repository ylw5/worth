# 封面主体抠图实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增资产时只对第一张封面图生成透明 PNG，列表优先展示抠图封面，同时保留原图识别、详情相册和失败回退。

**Architecture:** FastAPI 使用 `rembg` CPU 后端处理第一张 Supabase 签名图片，把最长边压到 1024px 后返回可选的 PNG Base64；Expo 客户端立即把结果上传到现有私有 bucket，并用独立的 `cover_photo_path` 持久化。抠图是非阻塞增强，任何失败都返回原图路径；编辑更换封面时清除旧抠图，不自动重新生成。

**Tech Stack:** Python 3.11、FastAPI、Pydantic、requests、Pillow、rembg 2.0.77 CPU、Expo SDK 57、React Native、TypeScript、Supabase Postgres/Storage。

## Global Constraints

- 只处理 `image_urls[0]`，其余原图只用于现有 AI 识别。
- 原图继续保存在 `photo_paths`，抠图只保存在可空的 `cover_photo_path`。
- 抠图失败不得阻塞识别、保存或估价。
- 抠图前把图片最长边限制为 1024px，输出必须是带透明通道的 PNG。
- 只允许服务端下载与 `SUPABASE_URL` 同源的 `http` 或 `https` 图片，拒绝任意外部 URL。
- 不增加原生模块、第三方收费 API、手工修图、任务队列、历史回填或编辑时自动重抠。
- 保留工作区中与本功能无关的现有修改；实施前重新检查状态，当前 `mobile/src/components/asset-card.tsx` 有用户未提交改动，不得整文件暂存。

---

## 文件结构

- Create `server/app/background_removal.py`：下载、缩放、抠图、PNG 编码和失败回退。
- Create `server/tests/test_background_removal.py`：覆盖同源校验、1024px 限制、PNG 输出和失败回退。
- Modify `server/app/models.py`：定义是否生成封面和 `/analyze` 的扩展响应。
- Modify `server/app/main.py`：把现有识别与可选抠图组合成一个响应。
- Modify `server/tests/test_openai_service.py`：验证全部图片仍用于识别，只有首图用于抠图。
- Modify `server/requirements.txt`：加入 `rembg[cpu]`。
- Modify `README.md`：把服务端 Python 版本写成 3.11–3.13。
- Create `supabase/migrations/202607240003_add_asset_cover_photo.sql`：新增可空封面路径。
- Modify `mobile/src/types/domain.ts`：加入封面路径和签名 URL。
- Modify `mobile/src/lib/assets.ts`：上传 PNG、签名封面、创建封面、编辑时清空封面。
- Modify `mobile/src/lib/api.ts`：解析 `/analyze` 的识别与封面结果。
- Modify `mobile/src/providers/draft-provider.tsx`：在确认草稿中保存可选封面路径和 URL。
- Modify `mobile/src/app/(tabs)/(capture)/index.tsx`：生成、上传并暂存第一张封面。
- Modify `mobile/src/app/confirm.tsx`：展示封面效果、原图和失败回退，并持久化封面。
- Modify `mobile/src/components/asset-card.tsx`：优先展示抠图封面。
- Modify `mobile/src/app/asset/[id]/edit.tsx`：编辑照片后清空并清理旧封面。

---

### Task 1: 服务端抠图边界

**Files:**
- Create: `server/app/background_removal.py`
- Create: `server/tests/test_background_removal.py`
- Modify: `server/requirements.txt`
- Modify: `README.md`

**Interfaces:**
- Consumes: `image_url: str` 和配置中的 `supabase_url: str`。
- Produces: `try_remove_background(image_url: str, supabase_url: str) -> str | None`，成功返回不带 data URL 前缀的 PNG Base64。

- [ ] **Step 1: 写失败测试**

创建 `server/tests/test_background_removal.py`：

```python
import base64
from io import BytesIO
from unittest.mock import Mock

from app import background_removal
from PIL import Image


def jpeg_bytes(size: tuple[int, int] = (1600, 800)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "white").save(output, "JPEG")
    return output.getvalue()


def test_rejects_non_supabase_image_origin(monkeypatch) -> None:
    get = Mock()
    monkeypatch.setattr(background_removal.requests, "get", get)

    result = background_removal.try_remove_background(
        "https://attacker.example/image.jpg",
        "https://project.supabase.co",
    )

    assert result is None
    get.assert_not_called()


def test_returns_resized_transparent_png(monkeypatch) -> None:
    monkeypatch.setattr(
        background_removal,
        "_download_image",
        lambda *_: jpeg_bytes(),
    )
    monkeypatch.setattr(background_removal, "_session", lambda: object())

    seen: dict[str, tuple[int, int]] = {}

    def fake_remove(image, session):
        seen["size"] = image.size
        result = image.convert("RGBA")
        result.putalpha(128)
        return result

    monkeypatch.setattr(background_removal, "remove", fake_remove)

    encoded = background_removal.try_remove_background(
        "https://project.supabase.co/storage/v1/object/sign/a.jpg",
        "https://project.supabase.co",
    )

    assert seen["size"] == (1024, 512)
    assert encoded is not None
    assert base64.b64decode(encoded).startswith(b"\x89PNG\r\n\x1a\n")


def test_returns_none_when_removal_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        background_removal,
        "_download_image",
        lambda *_: jpeg_bytes((10, 10)),
    )
    monkeypatch.setattr(
        background_removal,
        "_session",
        Mock(side_effect=RuntimeError("model unavailable")),
    )

    assert (
        background_removal.try_remove_background(
            "https://project.supabase.co/storage/v1/object/sign/a.jpg",
            "https://project.supabase.co",
        )
        is None
    )
```

- [ ] **Step 2: 用 Python 3.11 创建环境并确认测试失败**

当前 `.venv` 是 Python 3.9.6，而 `rembg` 2.0.77 要求 Python 3.11–3.13。先保留旧环境，再创建 3.11 环境：

```bash
cd server
worth_venv_backup="$(mktemp -d)/.venv"
mv .venv "$worth_venv_backup"
echo "$worth_venv_backup"
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pytest tests/test_background_removal.py -q
```

Expected: 输出旧环境的临时备份位置；测试 FAIL，因为 `app.background_removal` 尚不存在。

- [ ] **Step 3: 加入 CPU 抠图依赖和版本说明**

在 `server/requirements.txt` 加入：

```text
rembg[cpu]>=2.0.77,<3
```

把 `README.md` 的 macOS/Linux 服务端环境创建命令改为 `python3.11 -m venv .venv`，Windows 命令改为 `py -3.11 -m venv .venv`，并在 API 配置前说明：

```markdown
服务端需要 Python 3.11–3.13；`rembg` 当前不支持 Python 3.10 及以下或 3.14 及以上。
```

重新安装：

```bash
cd server
.venv/bin/python -m pip install -r requirements.txt
```

Expected: 安装成功，包含 `rembg`、`onnxruntime` 和 `Pillow`。

- [ ] **Step 4: 实现最小抠图模块**

创建 `server/app/background_removal.py`：

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
    supabase_origin = urlparse(supabase_url)
    if (
        image_origin.scheme not in {"http", "https"}
        or image_origin.scheme != supabase_origin.scheme
        or image_origin.netloc != supabase_origin.netloc
    ):
        raise ValueError("Cover image must use the configured Supabase origin")

    with requests.get(
        image_url,
        stream=True,
        timeout=20,
        allow_redirects=False,
    ) as response:
        response.raise_for_status()
        if not response.headers.get("content-type", "").startswith("image/"):
            raise ValueError("Cover source is not an image")
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_content(64 * 1024):
            size += len(chunk)
            if size > MAX_IMAGE_BYTES:
                raise ValueError("Cover source is too large")
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
        raise ValueError("Background removal returned an empty subject")

    output = BytesIO()
    cutout.save(output, "PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def try_remove_background(
    image_url: str,
    supabase_url: str,
) -> str | None:
    try:
        return _remove_background(image_url, supabase_url)
    except Exception:
        logger.exception("Cover background removal failed")
        return None
```

- [ ] **Step 5: 运行聚焦测试**

```bash
cd server
.venv/bin/python -m pytest tests/test_background_removal.py -q
```

Expected: `3 passed`。

- [ ] **Step 6: 提交服务端抠图边界**

```bash
git add README.md server/requirements.txt server/app/background_removal.py server/tests/test_background_removal.py
git commit -m "feat: add optional cover background removal"
```

---

### Task 2: `/analyze` 组合识别与可选封面

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/main.py`
- Modify: `server/tests/test_openai_service.py`

**Interfaces:**
- Consumes: Task 1 的 `try_remove_background(image_url, supabase_url)`。
- Produces: `AnalyzeRequest.generate_cover: bool` 和 `AnalyzeResponse.cover_image_base64: str | None`。

- [ ] **Step 1: 写失败的 API 测试**

在 `server/tests/test_openai_service.py` 追加：

```python
from fastapi.testclient import TestClient

from app.auth import require_user
from app.main import app
from app.models import AssetRecognition


def test_analyze_uses_all_images_and_only_cuts_first(monkeypatch) -> None:
    recognition = AssetRecognition(
        name="相机",
        category="数码",
        condition="良好",
        search_query="富士 X100VI",
    )
    analyze = Mock(return_value=recognition)
    service = Mock(analyze=analyze)
    cutout = Mock(return_value="png-base64")

    monkeypatch.setattr("app.main.OpenAIService", Mock(return_value=service))
    monkeypatch.setattr("app.main.try_remove_background", cutout)
    monkeypatch.setattr(
        "app.main.get_settings",
        lambda: Mock(supabase_url="https://project.supabase.co"),
    )
    app.dependency_overrides[require_user] = lambda: "user"
    try:
        response = TestClient(app).post(
            "/analyze",
            json={
                "image_urls": [
                    "https://project.supabase.co/front.jpg",
                    "https://project.supabase.co/label.jpg",
                ],
                "generate_cover": True,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["cover_image_base64"] == "png-base64"
    analyze.assert_called_once_with(
        [
            "https://project.supabase.co/front.jpg",
            "https://project.supabase.co/label.jpg",
        ],
        "user",
    )
    cutout.assert_called_once_with(
        "https://project.supabase.co/front.jpg",
        "https://project.supabase.co",
    )


def test_analyze_skips_cover_for_editing(monkeypatch) -> None:
    recognition = AssetRecognition(
        name="相机",
        category="数码",
        condition="良好",
        search_query="富士 X100VI",
    )
    service = Mock(analyze=Mock(return_value=recognition))
    cutout = Mock()

    monkeypatch.setattr("app.main.OpenAIService", Mock(return_value=service))
    monkeypatch.setattr("app.main.try_remove_background", cutout)
    app.dependency_overrides[require_user] = lambda: "user"
    try:
        response = TestClient(app).post(
            "/analyze",
            json={
                "image_urls": ["https://project.supabase.co/front.jpg"],
                "generate_cover": False,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["cover_image_base64"] is None
    cutout.assert_not_called()
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server
.venv/bin/python -m pytest tests/test_openai_service.py -q
```

Expected: FAIL，因为响应模型和 `generate_cover` 尚未实现。

- [ ] **Step 3: 扩展请求与响应模型**

在 `server/app/models.py` 中修改 `AnalyzeRequest` 并新增 `AnalyzeResponse`：

```python
class AnalyzeRequest(BaseModel):
    image_urls: list[str] = Field(min_length=1, max_length=5)
    generate_cover: bool = True


class AnalyzeResponse(AssetRecognition):
    cover_image_base64: Optional[str] = None
```

- [ ] **Step 4: 接入主路由**

在 `server/app/main.py` 导入：

```python
from .background_removal import try_remove_background
from .models import AnalyzeRequest, AnalyzeResponse, AssetInput, ValuationResult
```

把 `/analyze` 改为：

```python
@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(
    request: AnalyzeRequest,
    user_id: str = Depends(require_user),
) -> AnalyzeResponse:
    settings = get_settings()
    try:
        recognition = OpenAIService(settings).analyze(
            request.image_urls,
            user_id,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    cover = (
        try_remove_background(
            request.image_urls[0],
            settings.supabase_url,
        )
        if request.generate_cover
        else None
    )
    return AnalyzeResponse(
        **recognition.model_dump(),
        cover_image_base64=cover,
    )
```

- [ ] **Step 5: 运行全部服务端测试**

```bash
cd server
.venv/bin/python -m pytest -q
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交 API 组合逻辑**

```bash
git add server/app/models.py server/app/main.py server/tests/test_openai_service.py
git commit -m "feat: return optional cutout from photo analysis"
```

---

### Task 3: 持久化封面路径和签名 URL

**Files:**
- Create: `supabase/migrations/202607240003_add_asset_cover_photo.sql`
- Modify: `mobile/src/types/domain.ts`
- Modify: `mobile/src/lib/assets.ts`

**Interfaces:**
- Consumes: PNG Base64 和现有 `asset-photos` bucket。
- Produces:
  - `Asset.cover_photo_path: string | null`
  - `Asset.cover_photo_url?: string`
  - `uploadCover(base64: string, userId: string)`
  - `createAsset(..., coverPhotoPath: string | null)`
  - `updateAsset` 在收到 `photoPaths` 时清空数据库封面路径。

- [ ] **Step 1: 添加数据库迁移**

创建 `supabase/migrations/202607240003_add_asset_cover_photo.sql`：

```sql
alter table public.assets
add column cover_photo_path text;
```

- [ ] **Step 2: 扩展资产类型**

在 `mobile/src/types/domain.ts` 的 `Asset` 中加入：

```ts
cover_photo_path: string | null;
cover_photo_url?: string;
```

- [ ] **Step 3: 让资产读取签名封面**

把 `mobile/src/lib/assets.ts` 的 `withPhotoUrls` 改为：

```ts
async function signedUrl(path: string) {
  const { data, error } = await bucket.createSignedUrl(path, 3600);
  fail(error);
  return data?.signedUrl ?? '';
}

async function withPhotoUrls(asset: Asset): Promise<Asset> {
  const [photo_urls, cover_photo_url] = await Promise.all([
    Promise.all(asset.photo_paths.map(signedUrl)),
    asset.cover_photo_path ? signedUrl(asset.cover_photo_path) : undefined,
  ]);
  return { ...asset, photo_urls, cover_photo_url };
}
```

- [ ] **Step 4: 增加透明 PNG 上传**

保留现有 JPEG 行为，把上传公共部分限制在本文件内部：

```ts
async function uploadImage(
  base64: string,
  userId: string,
  extension: 'jpg' | 'png',
) {
  const file = Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0));
  const path = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;
  const { error } = await bucket.upload(path, file, {
    contentType: extension === 'png' ? 'image/png' : 'image/jpeg',
    upsert: false,
  });
  fail(error);
  const { data, error: signedUrlError } = await bucket.createSignedUrl(
    path,
    600,
  );
  fail(signedUrlError);
  if (!data?.signedUrl) throw new Error('无法读取照片');
  return { path, signedUrl: data.signedUrl };
}

export const uploadPhoto = (base64: string, userId: string) =>
  uploadImage(base64, userId, 'jpg');

export const uploadCover = (base64: string, userId: string) =>
  uploadImage(base64, userId, 'png');
```

- [ ] **Step 5: 在创建和编辑写入正确封面**

把 `createAsset` 签名改为：

```ts
export async function createAsset(
  userId: string,
  photoPaths: string[],
  input: AssetWriteInput,
  coverPhotoPath: string | null = null,
): Promise<Asset>
```

插入内容改为：

```ts
.insert({
  ...input,
  user_id: userId,
  photo_paths: photoPaths,
  cover_photo_path: coverPhotoPath,
})
```

把 `updateAsset` 的 update 对象改为：

```ts
.update({
  ...input,
  ...(photoPaths
    ? { photo_paths: photoPaths, cover_photo_path: null }
    : {}),
  updated_at: new Date().toISOString(),
})
```

- [ ] **Step 6: 运行客户端静态检查**

```bash
cd mobile
npx tsc --noEmit
npm run lint
```

Expected: 全部 PASS；默认 `null` 保持现有调用方兼容。

- [ ] **Step 7: 提交持久化契约**

```bash
git add \
  supabase/migrations/202607240003_add_asset_cover_photo.sql \
  mobile/src/types/domain.ts \
  mobile/src/lib/assets.ts
git commit -m "feat: persist optional asset covers"
```

---

### Task 4: 拍照、上传和确认页交互

**Files:**
- Modify: `mobile/src/lib/api.ts`
- Modify: `mobile/src/providers/draft-provider.tsx`
- Modify: `mobile/src/app/(tabs)/(capture)/index.tsx`
- Modify: `mobile/src/app/confirm.tsx`

**Interfaces:**
- Consumes: Task 2 的 `cover_image_base64` 和 Task 3 的 `uploadCover`。
- Produces: 草稿中的 `coverPhotoPath: string | null`、`coverPhotoUrl: string | null`，以及确认页的封面回退。

- [ ] **Step 1: 拆分识别与封面返回值**

在 `mobile/src/lib/api.ts` 新增：

```ts
type AnalyzeResponse = RecognitionInput & {
  cover_image_base64: string | null;
};
```

把 `analyzePhotos` 改为：

```ts
export async function analyzePhotos(
  imageUrls: string[],
  generateCover = true,
) {
  const { cover_image_base64, ...recognition } =
    await request<AnalyzeResponse>('/analyze', {
      image_urls: imageUrls,
      generate_cover: generateCover,
    });
  return {
    recognition: {
      ...recognition,
      purchase_date: '',
      purchase_price: '',
    },
    coverImageBase64: cover_image_base64,
  };
}
```

- [ ] **Step 2: 扩展草稿**

在 `mobile/src/providers/draft-provider.tsx` 的 `AssetDraft` 中加入：

```ts
coverPhotoPath: string | null;
coverPhotoUrl: string | null;
```

- [ ] **Step 3: 拍照页只上传第一张抠图**

在 `mobile/src/app/(tabs)/(capture)/index.tsx` 导入 `uploadCover`，把分析部分改为：

```ts
const { recognition, coverImageBase64 } = await analyzePhotos(
  uploaded.map((photo) => photo.signedUrl),
);
let cover: Awaited<ReturnType<typeof uploadCover>> | null = null;
if (coverImageBase64) {
  cover = await uploadCover(coverImageBase64, session.user.id).catch(
    () => null,
  );
  if (cover) uploadedPaths.push(cover.path);
}
setDraft({
  localUris: photos.map((photo) => photo.uri),
  photoPaths: uploaded.map((photo) => photo.path),
  coverPhotoPath: cover?.path ?? null,
  coverPhotoUrl: cover?.signedUrl ?? null,
  recognition,
});
```

把按钮的 `loading` 分支改为：

```tsx
<View
  style={{
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  }}>
  <ActivityIndicator color={colors.onDark} />
  <Text
    style={{
      color: colors.onDark,
      ...typography.body,
      fontWeight: '700',
    }}>
    正在识别并生成封面…
  </Text>
</View>
```

不新增进度条。

- [ ] **Step 4: 确认页区分封面效果和原图**

在 `mobile/src/app/confirm.tsx`：

1. 清理 effect 改为删除原图和可选封面：

```ts
useEffect(
  () => () => {
    if (!saved.current && draft) {
      removePhotos([
        ...draft.photoPaths,
        ...(draft.coverPhotoPath ? [draft.coverPhotoPath] : []),
      ]).catch(() => undefined);
    }
  },
  [draft],
);
```

2. 保存时把封面路径传给 `createAsset`：

```ts
const asset = await createAsset(
  session.user.id,
  draft.photoPaths,
  input,
  draft.coverPhotoPath,
);
```

3. 在原图网格上方加入：

```tsx
<View style={{ gap: spacing.sm }}>
  <Text
    selectable
    style={{
      color: colors.textPrimary,
      ...typography.body,
      fontWeight: '700',
    }}>
    封面效果
  </Text>
  <Image
    source={draft.coverPhotoUrl ?? draft.localUris[0]}
    contentFit="contain"
    style={{
      width: '100%',
      aspectRatio: 1.3,
      borderRadius: radius.large,
      backgroundColor: colors.surfaceMuted,
    }}
  />
  {!draft.coverPhotoUrl ? (
    <Text
      selectable
      style={{ color: colors.textSecondary, ...typography.caption }}>
      未能分离主体，将使用原图
    </Text>
  ) : null}
</View>
<Text
  selectable
  style={{
    color: colors.textPrimary,
    ...typography.body,
    fontWeight: '700',
  }}>
  原始照片
</Text>
```

- [ ] **Step 5: 修正编辑页的识别返回值**

在 `mobile/src/app/asset/[id]/edit.tsx` 把调用改为：

```ts
const { recognition } = await analyzePhotos(
  prepared.map((photo) => photo.analysisUrl ?? photo.uri),
  false,
);
```

这保证编辑页不会触发未使用的抠图计算。

- [ ] **Step 6: 运行客户端验证**

```bash
cd mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交新增资产交互**

```bash
git diff --check -- \
  mobile/src/lib/api.ts \
  mobile/src/providers/draft-provider.tsx \
  'mobile/src/app/(tabs)/(capture)/index.tsx' \
  mobile/src/app/confirm.tsx \
  'mobile/src/app/asset/[id]/edit.tsx'
git add \
  mobile/src/lib/api.ts \
  mobile/src/providers/draft-provider.tsx \
  'mobile/src/app/(tabs)/(capture)/index.tsx' \
  mobile/src/app/confirm.tsx \
  'mobile/src/app/asset/[id]/edit.tsx'
git commit -m "feat: upload generated asset covers"
```

Expected: 无空白错误并成功提交；如果执行时任一文件已出现新的用户修改，则跳过整文件暂存并保留未提交状态。

---

### Task 5: 列表优先封面和编辑清理

**Files:**
- Modify: `mobile/src/components/asset-card.tsx`
- Modify: `mobile/src/app/asset/[id]/edit.tsx`

**Interfaces:**
- Consumes: Task 3 的 `cover_photo_url` 和 `cover_photo_path`。
- Produces: 卡片回退表达式和编辑成功后的旧封面清理。

- [ ] **Step 1: 卡片优先使用抠图**

在 `mobile/src/components/asset-card.tsx` 把图片 source 改为：

```tsx
source={asset.cover_photo_url ?? asset.photo_urls?.[0]}
```

- [ ] **Step 2: 编辑保存只在照片变化时清空封面**

在 `mobile/src/app/asset/[id]/edit.tsx` 的 `updateAsset` 调用中，把第三个参数改为：

```ts
photosChanged
  ? prepared.map((photo) => photo.path as string)
  : undefined
```

保存成功后的清理路径改为：

```ts
await removePhotos([
  ...unusedStaged,
  ...removedPaths,
  ...(photosChanged && asset.cover_photo_path
    ? [asset.cover_photo_path]
    : []),
]).catch(() => undefined);
```

数据库更新成功前不删除旧封面；更新失败时现有错误分支继续保留旧封面。

- [ ] **Step 3: 运行全部客户端检查**

```bash
cd mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: 全部 PASS。

- [ ] **Step 4: 检查展示和编辑清理但不暂存重叠文件**

```bash
git diff --check -- \
  mobile/src/components/asset-card.tsx \
  'mobile/src/app/asset/[id]/edit.tsx'
```

Expected: 无空白错误。`asset-card.tsx` 的既有用户修改保持未暂存；为避免不完整提交，本任务不创建提交。

---

### Task 6: 数据库与端到端验证

**Files:**
- Verify only; no new production files expected.

**Interfaces:**
- Consumes: Tasks 1–5 的完整数据流。
- Produces: 可运行的本地数据库、服务端和 Expo 客户端。

- [ ] **Step 1: 应用迁移**

从仓库根目录运行：

```bash
source .env.local
npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING" --include-all
```

Expected: `202607240003_add_asset_cover_photo.sql` 成功应用。

- [ ] **Step 2: 运行全部自动检查**

```bash
cd server
.venv/bin/python -m pytest -q

cd ../mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: 服务端和客户端全部 PASS。

- [ ] **Step 3: 启动并验证真实交互**

终端一：

```bash
cd server
.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

终端二：

```bash
cd mobile
npm start
```

在设备上验证：

1. 添加至少两张照片，把第二张设为封面。
2. 点击“解析照片”，确认只出现一个“封面效果”，并能看到透明主体。
3. 保存后确认资产卡片使用抠图，详情相册仍是原始照片。
4. 临时让抠图模型不可用，确认识别和保存仍成功，确认页提示回退原图。
5. 编辑资产并更换封面，确认列表不再显示旧抠图，改用新的第一张原图。

- [ ] **Step 4: 检查改动范围**

```bash
git status --short
git diff --check
git log -5 --oneline
```

Expected: 服务端、迁移和无冲突的移动端提交清晰；`asset-card.tsx` 的既有用户改动与本功能改动保持未暂存，且 `git diff --check` 通过。
